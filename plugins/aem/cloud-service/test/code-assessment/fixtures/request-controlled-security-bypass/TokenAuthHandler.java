package com.example;

import javax.servlet.http.Cookie;
import javax.servlet.http.HttpServletRequest;
import javax.servlet.http.HttpServletResponse;
import org.apache.sling.auth.core.spi.AuthenticationHandler;
import org.apache.sling.auth.core.spi.AuthenticationInfo;

// Antipattern: a cookie loop compares cookie names; an e2e cookie or a debug parameter skips the check.
public abstract class TokenAuthHandler implements AuthenticationHandler {

    public AuthenticationInfo extractCredentials(HttpServletRequest request, HttpServletResponse response) {
        for (Cookie c : request.getCookies()) {
            if ("e2e-bypass".equals(c.getName())) {
                return trusted();
            }
        }
        if (request.getParameterMap().containsKey("debugAuth")) {
            return trusted();
        }
        return null;
    }

    abstract AuthenticationInfo trusted();
}
