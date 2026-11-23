# Reference Snippets (AMS, Core-7 Authoring)

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
  /docroot "${PUBLISH_DOCROOT}"
  /statfileslevel "2"
  /enableTTL "1"
  /allowAuthorized "0"
  /serveStaleOnError "1"
  /gracePeriod "5"
}
```

## AMS Render Baseline (Variable-Driven)

```apache
/renders {
  /rend01 {
    /hostname "${PUBLISH_IP}"
    /port "${PUBLISH_PORT}"
    /timeout "10000"
  }
}
```

## Author Session Management Baseline

```apache
/sessionmanagement {
  /directory "/tmp/sessions"
  /encode "md5"
  /header "HTTP:authorization"
  /timeout "600"
}
```

Use in author-tier farms only.

## Publish Vanity Baseline (AMS)

```apache
/vanity_urls {
  /url "/libs/granite/dispatcher/content/vanityUrls.html"
  /file "/tmp/vanity_urls"
  /delay "300"
}
```

Use in publish-tier farms when Dispatcher vanity polling is enabled.

## Flush ACL Baseline (`/allowedClients`)

```apache
/allowedClients {
  /0001 { /type "deny" /glob "*" }
  /0002 { /type "allow" /glob "10.0.1.10" }
  /0003 { /type "allow" /glob "10.0.1.11" }
}
```

Replace allow IPs with actual publish/flush-agent source addresses.

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

## HTTPS Vhost Baseline

```apache
<VirtualHost *:80>
  ServerName www.example.com
  Redirect permanent / https://www.example.com/
</VirtualHost>

<VirtualHost *:443>
  ServerName www.example.com
  SSLEngine on
  Header always set X-Frame-Options "SAMEORIGIN"
  Header always set X-Content-Type-Options "nosniff"
</VirtualHost>
```

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
