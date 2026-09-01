/*
 * RV test trigger — invokes the migrated delete over HTTP.
 * Not part of the customer migration output; used only by RV's runtime gate.
 */
package com.adobe.aem.guides.core.assets;

import org.apache.sling.api.SlingHttpServletRequest;
import org.apache.sling.api.SlingHttpServletResponse;
import org.apache.sling.api.servlets.SlingSafeMethodsServlet;
import org.osgi.service.component.annotations.Component;
import org.osgi.service.component.annotations.Reference;

import javax.servlet.Servlet;
import java.io.IOException;

@Component(service = Servlet.class, property = {
        "sling.servlet.paths=/bin/rv/deleteasset",
        "sling.servlet.methods=GET"
})
public class AssetCleanupServlet extends SlingSafeMethodsServlet {
    @Reference private transient AssetCleanupService service;
    @Override
    protected void doGet(SlingHttpServletRequest req, SlingHttpServletResponse res) throws IOException {
        String path = req.getParameter("path");
        res.setContentType("application/json");
        try {
            boolean deleted = service.deleteAsset(req.getResourceResolver(), path);
            res.getWriter().write("{\"deleted\":" + deleted + ",\"path\":\"" + path + "\"}");
        } catch (Exception e) {
            res.setStatus(500);
            res.getWriter().write("{\"error\":\"" + e.getClass().getSimpleName() + "\"}");
        }
    }
}
