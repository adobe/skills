package com.example.scheduler;

import org.osgi.service.component.annotations.Component;

// @Component + implements Runnable but NOT a scheduler — no scheduler.* property.
// Must NOT be flagged.
@Component(service = Runnable.class, property = { "service.ranking:Integer=100" })
public class PlainRunnableHelper implements Runnable {
    public void run() { }
}
