package com.example;

import org.apache.sling.api.SlingHttpServletRequest;
import org.apache.sling.api.SlingHttpServletResponse;
import org.apache.sling.api.servlets.SlingSafeMethodsServlet;

// Not security code: a debug parameter that only adds timing output is out of scope.
public class ProductListServlet extends SlingSafeMethodsServlet {

    @Override
    protected void doGet(SlingHttpServletRequest request, SlingHttpServletResponse response) {
        boolean debug = request.getParameter("debug") != null;
        if (debug) {
            response.setHeader("X-Timing", "1");
        }
    }
}
