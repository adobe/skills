package com.adobe.aem.guides.core.events;

import org.apache.sling.api.resource.ResourceResolver;
import org.osgi.service.event.Event;
import org.osgi.service.event.EventHandler;

/** Legacy: heavy business logic inline on the shared OSGi event thread. */
public class ReplicationEventHandler implements EventHandler {
    public void handleEvent(Event event) {
        ResourceResolver resolver = openResolver();
        doHeavyProcessing(resolver, event); // blocks the shared event thread
    }
    private ResourceResolver openResolver() { return null; }
    private void doHeavyProcessing(ResourceResolver r, Event e) { }
}
