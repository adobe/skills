/*
 * RV probe — asset delete.
 *
 *   GET /bin/rv/probe/asset-delete?fqcn=<serviceFqcn>&method=<name>&path=<jcrPath>
 *   -> { invoked, deleted, existed_before }
 *
 * Reflectively looks up the customer's service by FQCN and invokes
 *   <method>(ResourceResolver, String)
 * so RV can drive their migrated delete without customer test scaffolding.
 */
package com.adobe.aem.rv.probes;

import java.io.IOException;
import java.lang.reflect.Method;
import javax.servlet.Servlet;
import org.apache.sling.api.SlingHttpServletRequest;
import org.apache.sling.api.SlingHttpServletResponse;
import org.apache.sling.api.resource.ResourceResolver;
import org.apache.sling.api.servlets.SlingSafeMethodsServlet;
import org.osgi.framework.BundleContext;
import org.osgi.framework.FrameworkUtil;
import org.osgi.framework.ServiceReference;
import org.osgi.service.component.annotations.Component;

@Component(service = Servlet.class, property = {
        "sling.servlet.paths=/bin/rv/probe/asset-delete",
        "sling.servlet.methods=GET"
})
public class RvAssetProbeServlet extends SlingSafeMethodsServlet {
    @Override
    protected void doGet(SlingHttpServletRequest req, SlingHttpServletResponse res) throws IOException {
        String fqcn = req.getParameter("fqcn");
        String methodName = req.getParameter("method");
        String path = req.getParameter("path");
        res.setContentType("application/json");
        if (fqcn == null || methodName == null || path == null) { res.setStatus(400); res.getWriter().write("{\"error\":\"fqcn, method, path required\"}"); return; }

        boolean existedBefore = req.getResourceResolver().getResource(path) != null;
        try {
            BundleContext bc = FrameworkUtil.getBundle(RvAssetProbeServlet.class).getBundleContext();
            ServiceReference<?>[] refs = bc.getServiceReferences((String) null, "(objectClass=" + fqcn + ")");
            if (refs == null || refs.length == 0) { res.getWriter().write("{\"invoked\":false,\"error\":\"service not registered: " + fqcn + "\"}"); return; }
            Object svc = bc.getService(refs[0]);
            try {
                Method m = svc.getClass().getMethod(methodName, ResourceResolver.class, String.class);
                Object result = m.invoke(svc, req.getResourceResolver(), path);
                boolean stillExists = req.getResourceResolver().getResource(path) != null;
                res.getWriter().write("{\"invoked\":true,\"existed_before\":" + existedBefore
                        + ",\"return\":" + String.valueOf(result) + ",\"gone_after\":" + (!stillExists) + "}");
            } finally { bc.ungetService(refs[0]); }
        } catch (Exception e) {
            res.getWriter().write("{\"invoked\":false,\"error\":\"" + e.getClass().getSimpleName() + ": " + String.valueOf(e.getMessage()).replace("\"","\\\"") + "\"}");
        }
    }
}
