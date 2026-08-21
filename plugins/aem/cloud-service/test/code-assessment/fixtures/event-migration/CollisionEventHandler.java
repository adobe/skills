package com.example.events;

import com.acme.bus.EventHandler;

// Same simple name "EventHandler" from a non-OSGi package — must NOT be flagged.
public class CollisionEventHandler implements EventHandler {
    public void onMessage(String topic, Object payload) { }
}
