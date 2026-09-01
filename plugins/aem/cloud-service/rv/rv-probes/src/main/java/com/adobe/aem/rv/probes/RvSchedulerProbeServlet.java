/*
 * RV probe — scheduler.
 *
 * Reflectively inspects an arbitrary customer scheduler class:
 *   GET /bin/rv/probe/scheduler?pid=<customer FQCN>
 *   -> { registered, active, properties: { scheduler.expression, ...} }
 *
 * Used by customer-mode rv-check to verify their migrated scheduler on their
 * SDK without needing to modify their code.
 */
package com.adobe.aem.rv.probes;

import java.io.IOException;
import java.util.HashMap;
import java.util.Map;
import javax.servlet.Servlet;
import org.apache.sling.api.SlingHttpServletRequest;
import org.apache.sling.api.SlingHttpServletResponse;
import org.apache.sling.api.servlets.SlingSafeMethodsServlet;
import org.osgi.framework.BundleContext;
import org.osgi.framework.FrameworkUtil;
import org.osgi.framework.ServiceReference;
import org.osgi.service.component.annotations.Component;
import org.osgi.service.component.runtime.ServiceComponentRuntime;
import org.osgi.service.component.runtime.dto.ComponentConfigurationDTO;
import org.osgi.service.component.runtime.dto.ComponentDescriptionDTO;

@Component(service = Servlet.class, property = {
        "sling.servlet.paths=/bin/rv/probe/scheduler",
        "sling.servlet.methods=GET"
})
public class RvSchedulerProbeServlet extends SlingSafeMethodsServlet {

    @org.osgi.service.component.annotations.Reference
    private transient ServiceComponentRuntime scr;

    @Override
    protected void doGet(SlingHttpServletRequest req, SlingHttpServletResponse res) throws IOException {
        String pid = req.getParameter("pid");
        res.setContentType("application/json");
        if (pid == null || pid.isEmpty()) { res.setStatus(400); res.getWriter().write("{\"error\":\"pid required\"}"); return; }

        BundleContext bc = FrameworkUtil.getBundle(RvSchedulerProbeServlet.class).getBundleContext();
        ComponentDescriptionDTO desc = null;
        for (ComponentDescriptionDTO d : scr.getComponentDescriptionDTOs()) {
            if (pid.equals(d.name)) { desc = d; break; }
        }
        if (desc == null) { res.getWriter().write("{\"registered\":false}"); return; }

        boolean active = false;
        Map<String,Object> props = new HashMap<>();
        for (ComponentConfigurationDTO cfg : scr.getComponentConfigurationDTOs(desc)) {
            if (cfg.state == ComponentConfigurationDTO.ACTIVE || cfg.state == ComponentConfigurationDTO.SATISFIED) active = true;
            if (cfg.properties != null) props.putAll(cfg.properties);
        }
        StringBuilder sb = new StringBuilder();
        sb.append("{\"registered\":true,\"active\":").append(active).append(",\"properties\":{");
        boolean first = true;
        for (String key : new String[]{"scheduler.expression","scheduler.concurrent","scheduler.runOn"}) {
            Object v = props.get(key);
            if (v != null) {
                if (!first) sb.append(",");
                sb.append("\"").append(key).append("\":\"").append(String.valueOf(v).replace("\"","\\\"")).append("\"");
                first = false;
            }
        }
        sb.append("}}");
        res.getWriter().write(sb.toString());
    }
}
