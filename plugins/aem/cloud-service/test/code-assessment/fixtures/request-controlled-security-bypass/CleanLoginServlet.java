package com.example;

import javax.servlet.http.Cookie;
import org.apache.sling.api.SlingHttpServletRequest;
import org.apache.sling.api.SlingHttpServletResponse;
import org.apache.sling.api.servlets.SlingAllMethodsServlet;

// Clean: security code that reads ordinary names only ("latestVersion" must not match "test").
public class CleanLoginServlet extends SlingAllMethodsServlet {

    @Override
    protected void doPost(SlingHttpServletRequest request, SlingHttpServletResponse response) {
        String user = request.getParameter("j_username");
        String auth = request.getHeader("Authorization");
        Cookie token = request.getCookie("login-token");
        String version = request.getParameter("latestVersion");
        for (Cookie c : request.getCookies()) {
            if ("contest-entry".equals(c.getName())) { return; }
        }
    }
}
