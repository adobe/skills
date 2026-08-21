package com.example.scheduler;

import org.osgi.service.component.annotations.Component;

// OSGi DS scheduler pattern: @Component + implements Runnable + scheduler.expression in properties.
// Must be flagged — needs scheduler.runOn=SINGLE / scheduler.concurrent guards for Cloud Service.
@Component(
    service = Runnable.class,
    property = {
        "scheduler.expression=0 0 * * * ?",
        "scheduler.concurrent:Boolean=false"
    }
)
public class OsgiPropertyScheduler implements Runnable {
    public void run() { }
}
