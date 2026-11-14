package com.example.scheduler;

import org.apache.sling.commons.scheduler.Job;
import org.apache.sling.commons.scheduler.JobContext;

public class LegacyScheduler implements Job {
    public void execute(JobContext context) {
        // legacy Sling Scheduler Job — must migrate to Cloud Service-compatible properties or Sling Jobs
    }
}
