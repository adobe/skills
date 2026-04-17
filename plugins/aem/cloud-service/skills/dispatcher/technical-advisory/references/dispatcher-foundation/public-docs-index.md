# Public Docs Index (Dispatcher Source Of Truth)

Use this file as the curated public reference set for Cloud Dispatcher guidance.

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

## AEMaaCS Dispatcher (Cloud)

- Cloud Dispatcher overview: https://experienceleague.adobe.com/en/docs/experience-manager-cloud-service/content/implementing/content-delivery/disp-overview
- Content delivery overview: https://experienceleague.adobe.com/en/docs/experience-manager-cloud-service/content/implementing/content-delivery/overview
- Cloud Dispatcher migration notes: https://experienceleague.adobe.com/en/docs/experience-manager-cloud-service/content/implementing/content-delivery/disp-overview#migrating
- Validation and debugging: https://experienceleague.adobe.com/en/docs/experience-manager-cloud-service/content/implementing/content-delivery/validation-debug
- Validation and debugging (legacy): https://experienceleague.adobe.com/en/docs/experience-manager-cloud-service/content/implementing/content-delivery/validation-debug-legacy
- Local Dispatcher Tools setup: https://experienceleague.adobe.com/en/docs/experience-manager-learn/cloud-service/local-development-environment-set-up/dispatcher-tools
- Caching in AEMaaCS: https://experienceleague.adobe.com/en/docs/experience-manager-cloud-service/content/implementing/content-delivery/caching
- Edge Side Includes (ESI): https://experienceleague.adobe.com/en/docs/experience-manager-cloud-service/content/implementing/content-delivery/edge-side-includes
- CDN overview: https://experienceleague.adobe.com/en/docs/experience-manager-cloud-service/content/implementing/content-delivery/cdn
- CDN traffic configuration: https://experienceleague.adobe.com/en/docs/experience-manager-cloud-service/content/implementing/content-delivery/cdn-configuring-traffic
- CDN credentials/authentication: https://experienceleague.adobe.com/en/docs/experience-manager-cloud-service/content/implementing/content-delivery/cdn-credentials-authentication
- Pipeline-free redirects: https://experienceleague.adobe.com/en/docs/experience-manager-cloud-service/content/implementing/content-delivery/pipeline-free-url-redirects
- CDN cache purge: https://experienceleague.adobe.com/en/docs/experience-manager-cloud-service/content/implementing/content-delivery/cdn-cache-purge
- CDN error pages: https://experienceleague.adobe.com/en/docs/experience-manager-cloud-service/content/implementing/content-delivery/cdn-error-pages
- Traffic filter rules / WAF: https://experienceleague.adobe.com/en/docs/experience-manager-cloud-service/content/security/traffic-filter-rules-including-waf
- Advanced networking: https://experienceleague.adobe.com/en/docs/experience-manager-cloud-service/content/security/configuring-advanced-networking
- IMS support: https://experienceleague.adobe.com/en/docs/experience-manager-cloud-service/content/security/ims-support
- Cloud release notes: https://experienceleague.adobe.com/en/docs/experience-manager-cloud-service/content/release-notes/home
- AMS hosted on AEMaaCS architecture: https://experienceleague.adobe.com/en/docs/experience-manager-cloud-service/content/implementing/content-delivery/ams-aem

## Cloud Caching Tutorials (Experience League Learn)

- Caching overview: https://experienceleague.adobe.com/en/docs/experience-manager-learn/cloud-service/caching/overview
- Author-tier caching: https://experienceleague.adobe.com/en/docs/experience-manager-learn/cloud-service/caching/author
- Publish-tier caching: https://experienceleague.adobe.com/en/docs/experience-manager-learn/cloud-service/caching/publish
- CDN cache hit ratio analysis: https://experienceleague.adobe.com/en/docs/experience-manager-learn/cloud-service/caching/cdn-cache-hit-ratio-analysis
- Enable caching (how-to): https://experienceleague.adobe.com/en/docs/experience-manager-learn/cloud-service/caching/how-to/enable-caching
- Disable caching (how-to): https://experienceleague.adobe.com/en/docs/experience-manager-learn/cloud-service/caching/how-to/disable-caching
- Purge cache (how-to): https://experienceleague.adobe.com/en/docs/experience-manager-learn/cloud-service/caching/how-to/purge-cache

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
  - Validation and debugging
- Rewrite/redirect behavior questions:
  - Dispatcher configuration
  - pipeline-free redirects
- Cache headers / TTL / CDN behavior questions:
  - Caching in AEMaaCS
  - Dispatcher caching docs
- Cache operations questions (enable/disable/purge):
  - Enable caching (how-to)
  - Disable caching (how-to)
  - Purge cache (how-to)
- Cloud WAF or traffic filtering questions:
  - Traffic filter rules / WAF
  - CDN overview
- Cloud immutable/include/validator-compatibility questions:
  - Validation and debugging
  - Validation and debugging (legacy)
  - Cloud Dispatcher overview
- ESI and fragment composition questions:
  - Edge Side Includes (ESI)
  - Content delivery overview
- CDN vs Dispatcher ownership questions:
  - CDN overview
  - Cloud Dispatcher overview

## Usage Policy

1. Use only Experience League links listed in this file.
2. Keep recommendations scoped to `cloud` mode.
3. If docs and MCP runtime evidence conflict, state the conflict and prioritize executed evidence for environment-specific conclusions.
