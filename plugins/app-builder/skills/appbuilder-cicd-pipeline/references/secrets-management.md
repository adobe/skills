# Secrets Management for App Builder CI/CD

Source: [Adobe CI/CD Documentation](https://developer.adobe.com/app-builder/docs/guides/app_builder_guides/deployment/cicd-using-github-actions)

## OAuth Server-to-Server (S2S) Credentials

App Builder CI/CD uses OAuth S2S credentials with IMS authentication. **JWT credentials are deprecated** — do not use the `auth` command in `aio-apps-action`.

### Setting Up OAuth S2S Credentials

1. Open [Adobe Developer Console](https://developer.adobe.com/console/)
2. Navigate to your App Builder Project → target Workspace (Stage or Production)
3. Add the **I/O Management API** service to the workspace
  - This automatically creates an OAuth S2S credential if one doesn't exist
  - Ensures the credential has the correct scopes for deployment
4. Click **"Download all"** on the Workspace overview page to get `workspace.json`

### Extracting Secret Values

After downloading `workspace.json`:

```bash
# Navigate to your App Builder project root
cd /path/to/your/app

# Configure local workspace
aio app use /path/to/workspace.json
# When prompted, choose to MERGE .aio and .env files

# Extract secrets
chmod +x /path/to/fetch-secrets.sh
/path/to/fetch-secrets.sh
```

The script outputs 14 values. Add the workspace suffix (`_STAGE`, `_PROD`) when storing in GitHub.

## The 14 Required Secrets

| # | Secret Base Name | Source | Description |
| --- | --- | --- | --- |
| 1 | CLIENTID | OAuth S2S credential | Client ID for IMS authentication |
| 2 | CLIENTSECRET | OAuth S2S credential | Client secret (first secret in array) |
| 3 | TECHNICALACCID | OAuth S2S credential | Technical account ID (...@techacct.adobe.com) |
| 4 | TECHNICALACCEMAIL | OAuth S2S credential | Technical account email |
| 5 | IMSORGID | Organization | IMS Org ID (...@AdobeOrg) |
| 6 | SCOPES | OAuth S2S credential | Comma-separated OAuth scopes |
| 7 | AIO_RUNTIME_NAMESPACE | Workspace | Runtime namespace identifier |
| 8 | AIO_RUNTIME_AUTH | Workspace | Runtime auth key |
| 9 | AIO_PROJECT_ID | Project | Adobe project ID |
| 10 | AIO_PROJECT_NAME | Project | Adobe project name |
| 11 | AIO_PROJECT_ORG_ID | Organization | Organization numeric ID |
| 12 | AIO_PROJECT_WORKSPACE_ID | Workspace | Workspace ID |
| 13 | AIO_PROJECT_WORKSPACE_NAME | Workspace | Workspace name (e.g., "Stage") |
| 14 | AIO_PROJECT_WORKSPACE_DETAILS_SERVICES | Workspace | JSON array of enabled services |

## Storing Secrets in GitHub

1. Open your GitHub repository → Settings → Secrets and variables → Actions
2. Click **"New repository secret"**
3. Enter the secret name with workspace suffix (e.g., `CLIENTID_STAGE`)
4. Paste the value from `fetch-secrets.sh` output
5. Click **"Add secret"**

**⚠️ CRITICAL: Use "Repository secrets" — NOT "Environment secrets".** App Builder does not support GitHub environment secrets.

### Verification Checklist

After adding all secrets, verify:

- [ ] All 14 secrets present for Stage (`*_STAGE`)
- [ ] All 14 secrets present for Production (`*_PROD`) if needed
- [ ] Secrets are at **repository** level, not environment level
- [ ] `SCOPES` value is a comma-separated string, not a JSON array
- [ ] `AIO_PROJECT_WORKSPACE_DETAILS_SERVICES` is a valid JSON array

## Custom Application Secrets

If your app uses additional environment variables (API keys, endpoints, etc.):

1. Store the value as a repository secret (e.g., `MY_API_KEY_STAGE`)
2. Add it to the workflow's `env` section in the deploy step:`env:
  MY_API_KEY: ${{ secrets.MY_API_KEY_STAGE }}`
3. The value will be available as `process.env.MY_API_KEY` in your actions

## Credential Rotation

When rotating credentials:

1. Generate new OAuth S2S credential in Developer Console
2. Re-run `aio app use <workspace.json>` with updated config
3. Run `fetch-secrets.sh` to get new values
4. Update all affected repository secrets in GitHub
5. Re-run workflows to verify new credentials work

## Troubleshooting

- **"I/O Management API was not found"**: Add it to the workspace in Developer Console first
- **Deploy fails with 401/403**: Verify `CLIENTID`, `CLIENTSECRET`, and `SCOPES` are correct
- **"Invalid scopes"**: Ensure `SCOPES` is comma-separated, not a JSON array with brackets
- **Secrets not available in workflow**: Confirm secrets are repository-level, not environment-level