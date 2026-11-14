package com.example.scheduler;

import org.apache.felix.scr.annotations.Component;
import org.apache.felix.scr.annotations.Service;
import org.apache.felix.scr.annotations.Property;

// Felix SCR @Service(Runnable.class) but NOT a scheduler — no scheduler.* property. Must NOT be flagged.
@Component
@Service(Runnable.class)
@Property(name = "service.ranking", intValue = 100)
public class FelixPlainRunnable implements Runnable {
    public void run() { }
}
