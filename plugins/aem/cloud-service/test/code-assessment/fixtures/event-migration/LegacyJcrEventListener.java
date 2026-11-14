package com.example.events;

import javax.jcr.observation.EventListener;
import javax.jcr.observation.EventIterator;

// Legacy JCR observation listener — maps to event-migration per the BPA taxonomy
// (the guide redirects content-observation cases to resource-change-listener).
public class LegacyJcrEventListener implements EventListener {
    public void onEvent(EventIterator events) { }
}
