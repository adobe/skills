/*
 * RV — the offloaded work. Logs a unique marker RV can observe to prove the
 * handler successfully offloaded via JobManager.
 */
package com.adobe.aem.guides.core.events;

import org.apache.sling.event.jobs.Job;
import org.apache.sling.event.jobs.consumer.JobConsumer;
import org.osgi.service.component.annotations.Component;
import org.slf4j.Logger;
import org.slf4j.LoggerFactory;

@Component(service = JobConsumer.class, immediate = true, property = { "job.topics=rv/event/job" })
public class RvJobConsumer implements JobConsumer {
    private static final Logger LOG = LoggerFactory.getLogger(RvJobConsumer.class);
    @Override
    public JobResult process(Job job) {
        LOG.info("RV EVENT JOB EXECUTED {}", job.getProperty("id"));
        return JobResult.OK;
    }
}
