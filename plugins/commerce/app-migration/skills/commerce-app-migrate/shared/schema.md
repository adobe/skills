# Data Schemas: Migration Agents

This file defines the JSON data contracts exchanged between migration agents.
All agents that produce or consume these types must conform to these schemas exactly.

---

## ProjectSnapshot

Produced by the **Analyzer agent**. Consumed by all domain agents and the Executor agent.

```typescript
interface ProjectSnapshot {
  // "integration" if product-commerce/customer-commerce/order-commerce packages found
  // "checkout" if cart/payment/checkout packages found
  // "unknown" if no clear signals
  starterKitType: "integration" | "checkout" | "unknown";

  // "paas" if only COMMERCE_CONSUMER_KEY set in .env/env.dist
  // "saas" if only OAUTH_CLIENT_ID set in .env/env.dist
  // "dual" if BOTH COMMERCE_CONSUMER_KEY and OAUTH_CLIENT_ID are present
  // "unknown" if neither found
  authMode: "paas" | "saas" | "dual" | "unknown";

  // true if app.commerce.config.ts OR app.commerce.config.js exists at the project root
  alreadyMigrated: boolean;

  // All action packages from app.config.yaml (including $include-resolved, from
  // both application: and extensions: blocks)
  actionPackages: Array<{
    name: string;
    actions: Array<{
      name: string; // action name as in YAML
      function: string; // relative path to action entry file
      web: boolean; // true if web: 'yes'
    }>;
  }>;

  // All onboarding scripts found (scripts/onboarding/ or hooks/ or top-level scripts/)
  onboardingScripts: Array<{
    path: string; // relative path from project root
    // event-provider: creates event providers
    // event-subscription: subscribes to events / creates registrations
    // webhook: registers webhooks with Adobe Commerce
    // custom-installation: custom setup step not specific to events or webhooks
    // unknown: purpose not determinable from filename/imports
    purpose:
      | "event-provider"
      | "event-subscription"
      | "webhook"
      | "custom-installation"
      | "unknown";
  }>;

  // Extension points already declared in app.config.yaml extensions: block
  extensionPointsInUse: string[]; // e.g. ["commerce/backend-ui/1"]

  // Detected from lockfile presence
  packageManager: "npm" | "pnpm" | "yarn" | "bun";

  // OpenWhisk alarm triggers and rules found in any config file.
  // These CANNOT be migrated to App Management — must be flagged to the developer.
  // e.g. ["/whisk.system/alarms/alarm (dailyTrigger — 1440 min interval)"]
  openWhiskTriggers: string[];

  // true if mesh.json (with non-empty content) or .api-mesh/ directory exists
  // API Mesh config cannot be migrated and must be preserved manually
  hasMeshConfig: boolean;

  // true if any package in any config file has an `apis:` block (OpenWhisk API Gateway routes)
  // These have no equivalent in App Management and must be manually migrated
  hasApiGateway: boolean;

  // true if actions-src/ directory exists (TypeScript source compiled to actions/)
  // When true, action source files should be read from actions-src/ rather than actions/
  hasActionsSrcDir: boolean;

  // true if any OpenWhisk sequence is defined in any config file
  // Sequences have no equivalent in App Management and must be inlined into single actions
  hasSequences: boolean;

  // Commerce version constraints from app.config.yaml productDependencies block, if present.
  // e.g. { "minVersion": "2.4.4", "maxVersion": "2.4.8" }
  // null if no productDependencies block exists.
  productDependencies: { minVersion?: string; maxVersion?: string } | null;

  // Variable names parsed from env.dist (key names only — values are never stored).
  // Used by the Executor to identify obsolete env.dist entries after migration.
  // Empty array [] if env.dist does not exist.
  envDistKeys: string[];

  // npm scripts from package.json: script name → command string.
  // Used by Category C to detect README references to removable/automated scripts
  // via their npm alias (e.g. "npm run onboard" when "onboard" maps to a removable script).
  // Empty object {} if package.json has no scripts section.
  packageScripts: Record<string, string>;

  // Keys that appear more than once in env.dist (duplicate entries).
  // Only keys with count > 1 are included. Omitted or empty object means no duplicates.
  // e.g. { "COMMERCE_CONSUMER_KEY": 2 }
  envDistDuplicates?: Record<string, number>;

  confidence: {
    // "high": all data can be inferred statically
    // "medium": parseable but some fields missing
    // "low": signals present but ambiguous
    // "none": no signals found — skip this domain agent
    events: "high" | "medium" | "low" | "none";
    webhooks: "high" | "medium" | "low" | "none";
    adminUiSdk: "high" | "medium" | "low" | "none";
    businessConfig: "high" | "medium" | "low" | "none";
  };
}
```

### Example ProjectSnapshot (Integration SK, PaaS)

```json
{
  "starterKitType": "integration",
  "authMode": "paas",
  "alreadyMigrated": false,
  "actionPackages": [
    {
      "name": "product-commerce",
      "actions": [
        {
          "name": "consumer",
          "function": "actions/product/commerce/consumer/index.js",
          "web": false
        },
        {
          "name": "created",
          "function": "actions/product/commerce/created/index.js",
          "web": false
        }
      ]
    },
    {
      "name": "product-backoffice",
      "actions": [
        {
          "name": "consumer",
          "function": "actions/product/external/consumer/index.js",
          "web": false
        }
      ]
    }
  ],
  "onboardingScripts": [
    { "path": "scripts/onboarding/index.js", "purpose": "event-subscription" }
  ],
  "extensionPointsInUse": [],
  "packageManager": "npm",
  "openWhiskTriggers": [],
  "hasMeshConfig": false,
  "hasApiGateway": false,
  "hasActionsSrcDir": false,
  "hasSequences": false,
  "productDependencies": null,
  "envDistKeys": [
    "COMMERCE_CONSUMER_KEY",
    "OAUTH_CLIENT_ID",
    "AIO_EVENTS_PROVIDER_ID",
    "LOG_LEVEL"
  ],
  "envDistDuplicates": {},
  "packageScripts": {
    "onboard": "node scripts/onboarding/index.js"
  },
  "confidence": {
    "events": "high",
    "webhooks": "none",
    "adminUiSdk": "none",
    "businessConfig": "none"
  }
}
```

---

## DomainResult

Produced by each **domain agent** (events, webhooks, admin-ui-sdk, business-config).
Consumed by the **main orchestrator** to assemble the final `app.commerce.config.ts`.

```typescript
interface DomainResult {
  domain: "events" | "webhooks" | "adminUi" | "businessConfig";

  // Partial app.commerce.config.* content for this domain.
  // Will be merged with other domain fragments by the orchestrator.
  // Keys match top-level app.commerce.config.* fields:
  //   events domain     → { eventing: { commerce: [...], external: [...] } }
  //   webhooks domain   → { installation: { customInstallationSteps: [...] } }
  //   adminUi domain    → { adminUi: { menu?: {...}, order?: {...}, product?: {...}, customer?: {...} } }
  //   businessConfig    → { businessConfig: { schema: [...] } }
  configFragment: Record<string, unknown>;

  unresolvedQuestions: Array<{
    id: string; // dot-notation identifier, e.g. "events.provider.label"
    prompt: string; // human-readable question to display to developer
    default?: string; // suggested answer, shown as "(default: X)" — use when highly likely
  }>;
}
```

### Example DomainResult (events domain)

```json
{
  "domain": "events",
  "configFragment": {
    "eventing": {
      "commerce": [
        {
          "provider": {
            "label": "Commerce Provider",
            "description": "Commerce Provider that will receive events from commerce",
            "key": "commerce"
          },
          "events": [
            {
              "name": "observer.catalog_product_save_commit_after",
              "runtimeActions": ["product-commerce/consumer"],
              "description": "Triggered when a product is saved"
            }
          ]
        }
      ],
      "external": [
        {
          "provider": {
            "label": "Backoffice Provider",
            "description": "Backoffice Provider that will receive events from commerce"
          },
          "events": [
            {
              "name": "be-observer.catalog_product_create",
              "label": "Catalog Product Create",
              "description": "Triggered when a product is created externally",
              "runtimeActions": ["product-backoffice/consumer"]
            }
          ]
        }
      ]
    }
  },
  "unresolvedQuestions": []
}
```
