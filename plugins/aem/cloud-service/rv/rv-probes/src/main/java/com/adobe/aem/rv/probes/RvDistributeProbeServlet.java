/*
 * RV probe — replication distribute.
 *
 *   GET /bin/rv/probe/distribute?agent=<name>&path=<path>
 *   -> { api_present, invoked, success, state }
 *
 * Uses the SDK's live Distributor OSGi service — proves the Sling Distribution
 * API is wired on CS. No dependency on customer code (Distributor is a
 * platform service the migrated code uses).
 */
package com.adobe.aem.rv.probes;

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
import org.osgi.service.component.annotations.ReferenceCardinality;
import org.osgi.service.component.annotations.ReferencePolicy;

@Component(service = Servlet.class, property = {
        "sling.servlet.paths=/bin/rv/probe/distribute",
        "sling.servlet.methods=GET"
})
public class RvDistributeProbeServlet extends SlingSafeMethodsServlet {

    @Reference(cardinality = ReferenceCardinality.OPTIONAL, policy = ReferencePolicy.DYNAMIC)
    private volatile transient Distributor distributor;

    @Override
    protected void doGet(SlingHttpServletRequest req, SlingHttpServletResponse res) throws IOException {
        String agent = req.getParameter("agent"); if (agent == null) agent = "publish";
        String path = req.getParameter("path");
        res.setContentType("application/json");
        boolean apiPresent = distributor != null;
        if (!apiPresent) { res.getWriter().write("{\"api_present\":false,\"invoked\":false}"); return; }
        try {
            DistributionResponse dr = distributor.distribute(agent, req.getResourceResolver(),
                    new SimpleDistributionRequest(DistributionRequestType.ADD, path));
            res.getWriter().write("{\"api_present\":true,\"invoked\":true,\"success\":" + dr.isSuccessful()
                    + ",\"state\":\"" + dr.getState() + "\"}");
        } catch (Exception e) {
            res.getWriter().write("{\"api_present\":true,\"invoked\":true,\"success\":false,\"error\":\"" + e.getClass().getSimpleName() + "\"}");
        }
    }
}
