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
  /docroot "/var/www/html"
  /statfileslevel "2"
  /enableTTL "1"
  /allowAuthorized "0"
  /serveStaleOnError "1"
  /gracePeriod "5"
}
```

## Permission-Sensitive Caching (`/auth_checker`)

```apache
/auth_checker {
  /url "/bin/permissioncheck"
  /filter {
    /0001 { /type "allow" /glob "/content/secure/*" }
    /0002 { /type "deny" /glob "*" }
  }
  /headers {
    "Cookie"
    "Authorization"
  }
}
```

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
