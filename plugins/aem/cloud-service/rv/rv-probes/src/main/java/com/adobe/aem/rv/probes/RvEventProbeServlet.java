/*
 * RV probe — event fire.
 *
 *   GET /bin/rv/probe/fire-event?topic=<topic>&id=<uuid>
 *   -> { fired, topic, id }
 *
 * Posts an OSGi event on the given topic so RV can drive the customer's
 * migrated EventHandler → JobManager offload chain without them adding a
 * test-only servlet.
 */
package com.adobe.aem.rv.probes;

import java.io.IOException;
import java.util.HashMap;
import java.util.Map;
import javax.servlet.Servlet;
import org.apache.sling.api.SlingHttpServletRequest;
import org.apache.sling.api.SlingHttpServletResponse;
import org.apache.sling.api.servlets.SlingSafeMethodsServlet;
import org.osgi.service.component.annotations.Component;
import org.osgi.service.component.annotations.Reference;
import org.osgi.service.event.Event;
import org.osgi.service.event.EventAdmin;

@Component(service = Servlet.class, property = {
        "sling.servlet.paths=/bin/rv/probe/fire-event",
        "sling.servlet.methods=GET"
})
public class RvEventProbeServlet extends SlingSafeMethodsServlet {
    @Reference private transient EventAdmin eventAdmin;
    @Override
    protected void doGet(SlingHttpServletRequest req, SlingHttpServletResponse res) throws IOException {
        String topic = req.getParameter("topic");
        String id = req.getParameter("id");
        res.setContentType("application/json");
        if (topic == null || id == null) { res.setStatus(400); res.getWriter().write("{\"error\":\"topic, id required\"}"); return; }
        Map<String,Object> props = new HashMap<>();
        props.put("id", id);
        eventAdmin.postEvent(new Event(topic, props));
        res.getWriter().write("{\"fired\":true,\"topic\":\"" + topic + "\",\"id\":\"" + id + "\"}");
    }
}
