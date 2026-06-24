package com.example.events;

import com.acme.eventing.EventListener;

// Same simple name "EventListener" from a non-JCR package — must NOT be flagged.
public class JcrListenerCollision implements EventListener {
    public void handle(Object e) { }
}
