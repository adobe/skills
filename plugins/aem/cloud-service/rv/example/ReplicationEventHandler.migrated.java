package com.adobe.aem.guides.core.events;

import java.util.HashMap;
import java.util.Map;
import org.apache.sling.event.jobs.JobManager;
import org.osgi.service.event.Event;
import org.osgi.service.event.EventHandler;

/** Migrated: lightweight handler — offloads work to a Sling Job. */
public class ReplicationEventHandler implements EventHandler {
    private JobManager jobManager;
    public void handleEvent(Event event) {
        Map<String, Object> props = new HashMap<>();
        props.put("path", event.getProperty("path"));
        jobManager.addJob("rv/replication/followup", props); // offload — stays lightweight
    }
}
