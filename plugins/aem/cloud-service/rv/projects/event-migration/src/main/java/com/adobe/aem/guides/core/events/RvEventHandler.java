/*
 * RV — migrated EventHandler.
 * Under test: the CS pattern — handleEvent() offloads to a Sling Job, stays lightweight.
 */
package com.adobe.aem.guides.core.events;

import java.util.HashMap;
import java.util.Map;
import org.apache.sling.event.jobs.JobManager;
import org.osgi.service.component.annotations.Component;
import org.osgi.service.component.annotations.Reference;
import org.osgi.service.event.Event;
import org.osgi.service.event.EventHandler;

@Component(service = EventHandler.class, immediate = true, property = { "event.topics=rv/test/event" })
public class RvEventHandler implements EventHandler {
    @Reference private JobManager jobManager;
    @Override
    public void handleEvent(Event event) {
        Map<String, Object> props = new HashMap<>();
        props.put("id", event.getProperty("id"));
        jobManager.addJob("rv/event/job", props); // offload — the CS-correct behaviour
    }
}
