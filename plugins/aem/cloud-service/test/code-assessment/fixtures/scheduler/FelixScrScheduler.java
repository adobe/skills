package com.example.scheduler;

import org.apache.felix.scr.annotations.Component;
import org.apache.felix.scr.annotations.Service;
import org.apache.felix.scr.annotations.Properties;
import org.apache.felix.scr.annotations.Property;

// Legacy Felix SCR scheduler: @Service(Runnable.class) + @Properties declaring scheduler.expression.
// The pre-OSGi-DS stack many migrating projects still use. Must be flagged.
@Component
@Service(Runnable.class)
@Properties({
    @Property(name = "scheduler.expression", value = "0 0 * * * ?"),
    @Property(name = "scheduler.concurrent", boolValue = false)
})
public class FelixScrScheduler implements Runnable {
    public void run() { }
}
