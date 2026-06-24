package com.example.events;

import org.osgi.service.event.Event;
import org.osgi.service.event.EventHandler;

public class ReplicationEventHandler implements EventHandler {
    public void handleEvent(Event event) {
        // OSGi EventHandler with replication topic — must migrate to lightweight EventHandler + JobConsumer split
    }
}
