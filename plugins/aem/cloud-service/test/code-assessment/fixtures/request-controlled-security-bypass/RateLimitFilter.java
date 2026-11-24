package com.example;

import javax.servlet.Filter;
import javax.servlet.FilterChain;
import javax.servlet.ServletRequest;
import javax.servlet.ServletResponse;
import javax.servlet.http.HttpServletRequest;

// Antipattern: a request header turns the rate limit off.
public class RateLimitFilter implements Filter {

    public void doFilter(ServletRequest req, ServletResponse res, FilterChain chain) throws java.io.IOException, javax.servlet.ServletException {
        HttpServletRequest request = (HttpServletRequest) req;
        if (request.getHeader("X-Skip-Rate-Limit") == null && overLimit(request)) {
            return;
        }
        chain.doFilter(req, res);
    }

    private boolean overLimit(HttpServletRequest request) { return false; }
}
