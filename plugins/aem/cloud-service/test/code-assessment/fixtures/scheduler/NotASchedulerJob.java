package com.example.scheduler;

import com.acme.thirdparty.Job;

// Same simple name "Job" from a non-Sling package — must NOT be flagged.
public class NotASchedulerJob implements Job {
    public void run() { }
}
