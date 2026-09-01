/*
 * RV test trigger — fires an OSGi event so RV's runtime gate can drive
 * the handler over HTTP and observe the offloaded job's marker.
 */
package com.adobe.aem.guides.core.events;

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
        "sling.servlet.paths=/bin/rv/fireevent", "sling.servlet.methods=GET" })
public class RvFireEventServlet extends SlingSafeMethodsServlet {
    @Reference private transient EventAdmin eventAdmin;
    @Override
    protected void doGet(SlingHttpServletRequest req, SlingHttpServletResponse res) throws IOException {
        String id = req.getParameter("id");
        Map<String, Object> props = new HashMap<>();
        props.put("id", id);
        eventAdmin.postEvent(new Event("rv/test/event", props));
        res.setContentType("application/json");
        res.getWriter().write("{\"fired\":true,\"id\":\"" + id + "\"}");
    }
}
