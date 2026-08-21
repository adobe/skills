package com.example.scheduler;

import com.acme.di.Component;

// implements Runnable + a non-OSGi @Component (different package) carrying a scheduler.* property.
// Must NOT be flagged — the @Component is not org.osgi.service.component.annotations.Component.
@Component(property = { "scheduler.expression=0 0 * * * ?" })
public class CollisionComponentScheduler implements Runnable {
    public void run() { }
}
