package com.example.scheduler;

import org.apache.sling.commons.scheduler.Scheduler;

public class ProgrammaticScheduler {
    private Scheduler scheduler;

    public void start(Runnable r) {
        // programmatic Sling Scheduler use — must migrate
        scheduler.schedule(r, null);
    }
}
