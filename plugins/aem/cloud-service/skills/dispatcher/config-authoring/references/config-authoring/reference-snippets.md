# Reference Snippets (Cloud, Core-7 Authoring)

Use these snippets as **starting points** only. Always merge into project structure and validate/lint.

## Secure Filter Baseline

```apache
/filter {
  /0001 { /type "deny" /url "*" }
  /0100 { /type "allow" /path "/content/*" /method "GET" }
  /0101 { /type "allow" /path "/etc.clientlibs/*" /method "GET" }
  /0200 { /type "deny" /path "/crx/*" }
  /0201 { /type "deny" /path "/system/*" }
  /0300 { /type "deny" /selectors "(infinity|childrenlist|tidy|debug|ext)" }
}
```

Notes:
- Keep sensitive-path denies after broad allows when overlap is possible.
- Decompose candidate URLs using URL semantics before adding selector/suffix rules.

## Standard Cache Baseline

```apache
/cache {
  /docroot "${DOCROOT}"
  /statfileslevel "2"
  /enableTTL "1"
  /allowAuthorized "0"
  /serveStaleOnError "1"
  /gracePeriod "2"
}
```

## Marketing Query Parameter Baseline

```apache
/ignoreUrlParams {
  /0001 { /glob "*" /type "deny" }
  /0002 { /glob "q" /type "allow" }
  $include "../cache/marketing_query_parameters.any"
}
```

## Client Headers Baseline Extension

```apache
# Keep the managed default header set, then add only what is needed
$include "./default_clientheaders.any"
"X-Custom-App-Header"
```

Notes:
- do not remove `Authorization`, `Cookie`, `Host`, `X-Forwarded-Proto`, or `x-request-id` without explicit feature impact review
- treat clientheaders edits as upstream contract changes, not cosmetic cleanup

## Probe-Safe Canonical Redirect Guard

```apache
RewriteCond %{REQUEST_URI} !^/systemready$
RewriteCond %{REQUEST_URI} !^/system/probes/
RewriteRule ^ https://www.example.com%{REQUEST_URI} [R=301,L]
```

## Persisted Query Cache Rewrite Guard

```apache
RewriteCond %{REQUEST_URI} ^/graphql/execute.json
RewriteRule ^/(.*)$ /$1;.json [PT]
```

## Permission-Sensitive Caching (`/auth_checker`)

**AEM requirement:** A servlet must exist at `/bin/permissioncheck` (HEAD/GET, param `uri`, return 200 when authorized and 403 when not). Create it in the project core bundle and allowlist the path on publish via `SlingServletResolver` config. Without the servlet, Dispatcher has nothing to call. See [Cache secured content](https://experienceleague.adobe.com/en/docs/experience-manager-dispatcher/using/configuring/permissions-cache).

```apache
/auth_checker {
  /url "/bin/permissioncheck"
  /filter {
    /0000 { /type "deny" /glob "*" }
    /0001 { /type "allow" /glob "/content/secure/*.html" }
  }
  /headers {
    /0000 { /type "deny" /glob "*" }
    /0001 { /type "allow" /glob "Set-Cookie:*" }
  }
}
```

Set `/allowAuthorized "1"` in `/cache`. Ensure the farm filter allows only GET/HEAD to `/bin/permissioncheck` (least privilege). Request headers Cookie and Authorization are forwarded via `/clientheaders` (default_clientheaders.any).

## Cloud Header / Redirect Baseline

```apache
<VirtualHost *:80>
  ServerName www.example.com
  RewriteEngine On
  RewriteCond %{REQUEST_URI} !^/systemready$
  RewriteCond %{REQUEST_URI} !^/system/probes/
  RewriteRule ^ https://www.example.com%{REQUEST_URI} [R=301,L]

  Header always set Strict-Transport-Security "max-age=31536000; includeSubDomains; preload"
  Header always set X-Frame-Options "SAMEORIGIN"
  Header always set X-Content-Type-Options "nosniff"
</VirtualHost>
```

Notes:
- for cloud-service, keep examples aligned to the managed `*:80` Apache shape; upstream TLS termination still allows response header injection such as HSTS
- do not copy a standalone `*:443` vhost pattern into the cloud dispatcher repo

## CORS Baseline (Headless/API)

```apache
<IfModule mod_headers.c>
  Header always set Access-Control-Allow-Origin "https://app.example.com"
  Header always set Access-Control-Allow-Methods "GET, POST, OPTIONS"
  Header always set Access-Control-Allow-Headers "Content-Type, Authorization"
  Header always set Vary "Origin"
</IfModule>
```

## Validation Reminder

After adapting snippets:

1. `validate` dispatcher and/or httpd blocks
2. `lint` with mode-appropriate depth
3. `sdk(action="check-files")`
4. runtime evidence for at least one allow, one deny, and one cache candidate
