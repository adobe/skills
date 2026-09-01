/*
 * RV — migrated replication code (Sling Distribution API) + trigger.
 * Under test: uses Distributor + SimpleDistributionRequest (the CS API),
 * not the removed CQ Replicator.
 */
package com.adobe.aem.guides.core.repl;

import java.io.IOException;
import javax.servlet.Servlet;
import org.apache.sling.api.SlingHttpServletRequest;
import org.apache.sling.api.SlingHttpServletResponse;
import org.apache.sling.api.servlets.SlingSafeMethodsServlet;
import org.apache.sling.distribution.DistributionRequestType;
import org.apache.sling.distribution.DistributionResponse;
import org.apache.sling.distribution.Distributor;
import org.apache.sling.distribution.SimpleDistributionRequest;
import org.osgi.service.component.annotations.Component;
import org.osgi.service.component.annotations.Reference;

@Component(service = Servlet.class, property = {
        "sling.servlet.paths=/bin/rv/distribute", "sling.servlet.methods=GET" })
public class RvDistributeServlet extends SlingSafeMethodsServlet {

    @Reference private transient Distributor distributor;

    @Override
    protected void doGet(SlingHttpServletRequest req, SlingHttpServletResponse res) throws IOException {
        String path = req.getParameter("path");
        String agent = req.getParameter("agent");
        if (agent == null) agent = "publish";
        res.setContentType("application/json");
        boolean servicePresent = distributor != null;
        try {
            DistributionResponse dr = distributor.distribute(agent, req.getResourceResolver(),
                    new SimpleDistributionRequest(DistributionRequestType.ADD, path));
            res.getWriter().write("{\"servicePresent\":" + servicePresent
                    + ",\"invoked\":true,\"success\":" + dr.isSuccessful()
                    + ",\"state\":\"" + dr.getState() + "\"}");
        } catch (Exception e) {
            res.getWriter().write("{\"servicePresent\":" + servicePresent
                    + ",\"invoked\":true,\"success\":false,\"error\":\"" + e.getClass().getSimpleName() + "\"}");
        }
    }
}
