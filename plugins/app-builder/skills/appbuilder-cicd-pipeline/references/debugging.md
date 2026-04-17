# CI/CD Pipeline Debugging Reference

Common deployment and pipeline debugging scenarios for App Builder CI/CD.

## 1. `aio app deploy` Fails with "Not Logged In"

**Symptom:** `aio app deploy` returns `Error: You are not logged in. Please log in using "aio login"` or `Error: Cannot read properties of undefined (reading 'access_token')`.

**Cause:** CLI v11+ requires IMS authentication via `aio login` or OAuth S2S credentials. The session may have expired, or the auth context is pointing to the wrong organization.

**Fix:**
```bash
# Check current auth context
aio auth login --list

# Log in interactively (for local development)
aio login

# For CI/CD, verify OAuth S2S credentials are injected correctly
# Check that all 14 secrets are set and IMSORGID is correct
aio app use <workspace.json>

# Verify the active context has a valid token
aio auth ctx --list
```

**Prevention:**
- In CI/CD, use `adobe/aio-cli-setup-action@3` which handles auth setup automatically
- Ensure all 14 repository secrets are set with correct workspace suffix (`_STAGE` / `_PROD`)
- Never use the deprecated `auth` command in `aio-apps-action` — it is JWT-based and no longer supported

---

## 2. Deploy Succeeds but App Returns Old Code

**Symptom:** `aio app deploy` completes successfully with no errors, but the application still serves the old version when accessed in a browser.

**Cause:** Adobe's CDN caches static assets aggressively. After the CDN upgrade (Sept 2025), caching behavior became more aggressive with longer TTLs.

**Fix:**
```bash
# 1. Verify the deployment actually updated by checking activation logs
aio runtime activation list --limit 5
aio runtime activation get <activationId>

# 2. Force cache bypass in browser
# Add ?nocache=<timestamp> to the URL, or use Ctrl+Shift+R (hard refresh)

# 3. Add cache-busting headers to your web-src (in web-src/src/index.html or app config)
# Set Cache-Control: no-cache, no-store for development deployments

# 4. Verify deployed action code matches local
aio runtime action get <action-name> --url
```

**Prevention:**
- Use unique build identifiers or content hashing in your web assets
- Include version metadata in your Runtime actions (e.g., return build timestamp in health check endpoints)
- For Stage deployments, configure shorter CDN TTLs via `app.config.yaml`

---

## 3. GitHub Actions Workflow Fails at "Setup CLI" Step

**Symptom:** Workflow fails at the `adobe/aio-cli-setup-action@3` step with `Error: Node.js version 16.x is not supported` or `Cannot find module '@adobe/aio-cli'`.

**Cause:** Node.js version mismatch. `aio-cli-setup-action@3` requires Node.js 18+. The workflow runner may be using an older default.

**Fix:**
```yaml
# Ensure setup-node runs BEFORE aio-cli-setup-action
- uses: actions/setup-node@v4
  with:
    node-version: '20'  # Minimum: 18. Recommended: 20

# Node version compatibility matrix:
# Node 16 — NOT SUPPORTED (EOL Dec 2023)
# Node 18 — Minimum supported
# Node 20 — Recommended (LTS until Apr 2026)
# Node 22 — Supported (LTS until Apr 2027)
```

**Prevention:**
- Always pin `actions/setup-node@v4` with `node-version: '20'` before CLI setup
- Use the workflow templates from `assets/` which include correct Node.js version
- Add a Node.js version check to your CI: `node --version` as a debug step

---

## 4. GitHub Actions Deploy Fails with "Credentials" Error

**Symptom:** Deploy step fails with `Error: Missing required credentials` or `Error: Unable to deploy - missing IMS configuration` or `Error: Cannot read properties of undefined (reading 'client_id')`.

**Cause:** Missing or incorrectly configured repository secrets. Common mistakes: using environment secrets instead of repository secrets, wrong suffix, or missing secrets.

**Fix:**

Verify all 14 required secrets (per workspace):
```
CLIENTID_STAGE                    CLIENTSECRET_STAGE
TECHNICALACCID_STAGE              TECHNICALACCEMAIL_STAGE
IMSORGID_STAGE                    SCOPES_STAGE
AIO_RUNTIME_NAMESPACE_STAGE       AIO_RUNTIME_AUTH_STAGE
AIO_PROJECT_ID_STAGE              AIO_PROJECT_NAME_STAGE
AIO_PROJECT_ORG_ID_STAGE          AIO_PROJECT_WORKSPACE_ID_STAGE
AIO_PROJECT_WORKSPACE_NAME_STAGE  AIO_PROJECT_WORKSPACE_DETAILS_SERVICES_STAGE
```

```bash
# Test secrets locally by simulating the CI environment
aio app use <workspace.json>
cat .env  # Verify all values are populated

# Re-extract secrets if needed (run from the skill directory, or copy the script to your project)
bash /path/to/skills/appbuilder-cicd-pipeline/assets/fetch-secrets.sh
```

Common mistakes:
- **Environment secrets vs repository secrets:** App Builder does NOT support GitHub environment secrets — use repository secrets only
- **Missing suffix:** Each secret must end with `_STAGE` or `_PROD`
- **Stale credentials:** Re-download `workspace.json` if credentials were rotated

**Prevention:**
- Use `assets/fetch-secrets.sh` to extract all 14 secrets at once
- Cross-reference against the secrets table in `references/github-actions-guide.md`
- Add a secrets validation step early in your workflow to fail fast

---

## 5. Deploy to Stage Works but Production Fails

**Symptom:** The Stage deployment workflow succeeds, but the Production deployment fails with credentials or workspace errors.

**Cause:** Workspace-specific secrets mismatch. Stage and Production workspaces have different credentials, and Production may not be fully provisioned.

**Fix:**
```bash
# 1. Verify Production workspace exists in Developer Console
aio console workspace list

# 2. Verify Production workspace has I/O Management API
aio console workspace select Production
aio console workspace services  # Should include I/O Management API

# 3. Download Production workspace.json separately
# Developer Console → Project → Production workspace → Download All

# 4. Extract Production secrets with correct suffix
aio app use production-workspace.json
# Run fetch-secrets.sh and add all values with _PROD suffix

# 5. Compare Stage vs Production configurations
diff <(aio console workspace select Stage && aio console workspace services) \
     <(aio console workspace select Production && aio console workspace services)
```

**Prevention:**
- Provision Production workspace with identical APIs/services as Stage
- Use a secrets setup checklist for each workspace (see `references/checklist.md`)
- Document which APIs are enabled per workspace in your project README

---

## 6. `aio app undeploy` Leaves Orphaned Resources

**Symptom:** After `aio app undeploy`, Events registrations still fire, API Mesh configs remain active, or State/Files storage still contains data.

**Cause:** `aio app undeploy` only removes Runtime actions and web assets. It does not clean up Events registrations, API Mesh configurations, or data in State/Files storage.

**Fix:**
```bash
# 1. Remove Runtime actions (done by undeploy)
aio app undeploy

# 2. Clean up Events registrations
aio event registration list
aio event registration delete <registrationId>

# 3. Clean up API Mesh (if used)
aio api-mesh delete

# 4. Clean up State storage (if used)
# This requires programmatic cleanup — call state.deleteAll() in a cleanup script

# 5. Clean up Files storage (if used)
# Similar to State — call files.delete('*') in a cleanup script

# 6. Verify all resources are removed
aio runtime action list   # Should show no actions for this app
aio event registration list  # Should show no registrations
```

**Prevention:**
- Maintain a resource inventory document listing all provisioned resources
- Create a cleanup script that handles all resource types (not just undeploy)
- Use `aio app undeploy --force-unpublish` to also remove Extensions from Exchange

---

## 7. Build Succeeds Locally but Fails in CI

**Symptom:** `aio app build` or `aio app test` passes on the developer machine but fails in GitHub Actions with `npm ERR! code ERESOLVE` or missing module errors or test failures due to undefined environment variables.

**Cause:** Differences between local and CI environments: lockfile mismatch (local uses `npm install`, CI uses `npm ci`), missing `.env` variables (secrets not injected), or different Node.js version.

**Fix:**
```bash
# 1. Ensure lockfile is committed and up to date
npm install
git add package-lock.json
git commit -m "chore: update lockfile"
# Note: aio app pack (v14.3.0+) includes package-lock.json by default

# 2. Verify CI has all required environment variables
# Check your workflow's env section matches your local .env keys
# Secrets must be injected via ${{ secrets.SECRET_NAME_SUFFIX }}

# 3. Match Node.js version between local and CI
node --version  # Check local version
# Update workflow to match:
# - uses: actions/setup-node@v4
#   with:
#     node-version: '20'

# 4. Reproduce CI behavior locally
rm -rf node_modules
npm ci  # Uses lockfile exactly as CI does
aio app build
aio app test
```

**Prevention:**
- Always commit `package-lock.json` and use `npm ci` in CI workflows
- Pin Node.js version in both `.nvmrc` (local) and workflow YAML (CI)
- Create a `.env.example` listing all required env vars so CI config stays in sync

---

## 8. Multi-Workspace Promotion Issues (Stage → Prod)

**Symptom:** App works in Stage workspace but fails after promotion to Production. Common errors: `Error: API not available`, `Error: Missing scope`, or actions fail with permission denied.

**Cause:** Stage and Production workspaces have different configurations — different APIs enabled, different OAuth scopes, or different service configurations.

**Fix:**
```bash
# 1. Compare workspace configurations
aio console workspace select Stage
aio console workspace services > stage-services.txt

aio console workspace select Production
aio console workspace services > prod-services.txt

diff stage-services.txt prod-services.txt

# 2. Add missing APIs to Production workspace
# Open Developer Console → Project → Production workspace
# Add any APIs that exist in Stage but not Production

# 3. Compare OAuth scopes
# In Developer Console, compare the OAuth S2S credential scopes between workspaces
# Ensure Production credential has all scopes that Stage has

# 4. Re-extract Production secrets after adding APIs
aio app use production-workspace.json
bash /path/to/skills/appbuilder-cicd-pipeline/assets/fetch-secrets.sh
# Update all _PROD secrets in GitHub repository settings

# 5. Verify SCOPES secret matches
# The SCOPES secret must contain all comma-separated scopes required by the app
echo $SCOPES  # Compare between Stage and Prod
```

**Prevention:**
- Create a workspace provisioning checklist documenting all required APIs and scopes
- Before each Production release, run a workspace comparison check
- Automate workspace config comparison in your CI pipeline as a pre-deploy validation step
- Use `aio console` commands in a script to verify both workspaces have identical service configurations
