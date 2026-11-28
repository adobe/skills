# Public Docs Index (Dispatcher Source Of Truth)

Use this file as the curated public reference set for AMS Dispatcher guidance.

## Dispatcher Core (Common Experience League)

- Dispatcher overview: https://experienceleague.adobe.com/en/docs/experience-manager-dispatcher/using/dispatcher
- Dispatcher FAQ: https://experienceleague.adobe.com/en/docs/experience-manager-dispatcher/using/troubleshooting/dispatcher-faq
- Dispatcher install: https://experienceleague.adobe.com/en/docs/experience-manager-dispatcher/using/getting-started/dispatcher-install
- Dispatcher configuration: https://experienceleague.adobe.com/en/docs/experience-manager-dispatcher/using/configuring/dispatcher-configuration
- Content filter config: https://experienceleague.adobe.com/en/docs/experience-manager-dispatcher/using/configuring/dispatcher-configuration#configuring-access-to-content-filter
- Caching docs: https://experienceleague.adobe.com/en/docs/experience-manager-dispatcher/using/configuring/dispatcher-configuration#caching-documents
- Cache invalidation: https://experienceleague.adobe.com/en/docs/experience-manager-dispatcher/using/configuring/dispatcher-configuration#invalidating-files-by-folder-level
- Flush from AEM: https://experienceleague.adobe.com/en/docs/experience-manager-dispatcher/using/configuring/dispatcher-configuration#invalidating-dispatcher-cache-from-aem
- Dispatcher domains: https://experienceleague.adobe.com/en/docs/experience-manager-dispatcher/using/configuring/dispatcher-domains
- Dispatcher SSL: https://experienceleague.adobe.com/en/docs/experience-manager-dispatcher/using/configuring/dispatcher-ssl
- Permissions cache: https://experienceleague.adobe.com/en/docs/experience-manager-dispatcher/using/configuring/permissions-cache
- Page invalidate patterns: https://experienceleague.adobe.com/en/docs/experience-manager-dispatcher/using/configuring/page-invalidate
- Dispatcher troubleshooting: https://experienceleague.adobe.com/en/docs/experience-manager-dispatcher/using/troubleshooting/dispatcher-troubleshooting
- Security checklist: https://experienceleague.adobe.com/en/docs/experience-manager-dispatcher/using/getting-started/security-checklist
- Dispatcher release notes: https://experienceleague.adobe.com/en/docs/experience-manager-dispatcher/using/getting-started/release-notes
- Dispatcher CSRF hardening: https://experienceleague.adobe.com/en/docs/experience-manager-dispatcher/using/configuring/configuring-dispatcher-to-prevent-csrf

## AEM 6.5 LTS / AMS Dispatcher

- AMS dispatcher intro: https://experienceleague.adobe.com/en/docs/experience-manager-learn/ams/dispatcher/what-is-the-dispatcher
- AMS basic file layout: https://experienceleague.adobe.com/en/docs/experience-manager-learn/ams/dispatcher/basic-file-layout
- AMS config files: https://experienceleague.adobe.com/en/docs/experience-manager-learn/ams/dispatcher/explanation-config-files
- AMS variables: https://experienceleague.adobe.com/en/docs/experience-manager-learn/ams/dispatcher/variables
- AMS immutable files: https://experienceleague.adobe.com/en/docs/experience-manager-learn/ams/dispatcher/immutable-files
- AMS dispatcher manual: https://experienceleague.adobe.com/en/docs/experience-manager-learn/ams/dispatcher/overview
- AMS common logs: https://experienceleague.adobe.com/en/docs/experience-manager-learn/ams/dispatcher/common-logs
- AMS flushing: https://experienceleague.adobe.com/en/docs/experience-manager-learn/ams/dispatcher/disp-flushing
- AMS vanity URLs: https://experienceleague.adobe.com/en/docs/experience-manager-learn/ams/dispatcher/disp-vanity-url
- AMS health check: https://experienceleague.adobe.com/en/docs/experience-manager-learn/ams/dispatcher/health-check
- AMS git symlinks: https://experienceleague.adobe.com/en/docs/experience-manager-learn/ams/dispatcher/git-symlinks
- AMS understanding cache: https://experienceleague.adobe.com/en/docs/experience-manager-learn/ams/dispatcher/understanding-cache

## Key Concepts

- Filter evaluation: last applied rule wins (see content filter docs).
- URL decomposition for all URL-based rules (filters, cache rules): use path/selectors/extension/suffix; in filters use (`/path`, `/selectors`, `/extension`, `/suffix`) from Dispatcher configuration docs.

## Question-To-Doc Mapping

- Filter conflict/order questions:
  - Content filter config
  - Security checklist
- CSRF mitigation questions:
  - Dispatcher CSRF hardening
  - Content filter config
- `statfileslevel` / invalidation blast-radius questions:
  - Cache invalidation by folder level
  - Flush from AEM
- URL decomposition / selector-suffix questions (filters, cache rules):
  - Content filter config
  - Caching docs
  - AMS config files
- Rewrite/redirect behavior questions:
  - Dispatcher configuration
  - AMS dispatcher manual
- Cache headers / TTL behavior questions:
  - Dispatcher caching docs
  - AMS dispatcher manual
- AMS layout/immutability questions:
  - AMS basic file layout
  - AMS immutable files
- AMS tier/farm ordering questions:
  - AMS basic file layout
  - AMS config files
- AMS render/docroot variable usage questions:
  - AMS variables
  - AMS config files
- AMS flush ACL (`/allowedClients`) questions:
  - AMS flushing
  - Flush from AEM
- AMS vanity polling (`/vanity_urls` + `/delay`) questions:
  - AMS vanity URLs
  - Vanity URLs enablement in Dispatcher configuration

## Usage Policy

1. Use only Experience League links listed in this file.
2. Keep recommendations scoped to `ams` mode.
3. If docs and MCP runtime evidence conflict, state the conflict and prioritize executed evidence for environment-specific conclusions.
