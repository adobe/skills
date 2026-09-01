/*
 *  Copyright 2015 Adobe Systems Incorporated
 *
 *  Licensed under the Apache License, Version 2.0 (the "License");
 *  you may not use this file except in compliance with the License.
 */
package com.adobe.aem.guides.core.schedulers;

import org.osgi.service.component.annotations.Activate;
import org.osgi.service.component.annotations.Component;
import org.osgi.service.component.annotations.Modified;
import org.osgi.service.metatype.annotations.AttributeDefinition;
import org.osgi.service.metatype.annotations.Designate;
import org.osgi.service.metatype.annotations.ObjectClassDefinition;
import org.slf4j.Logger;
import org.slf4j.LoggerFactory;

/**
 * Cloud Service compatible scheduled task.
 * Migrated by the `scheduler` skill (Path A): Runnable + OSGi component properties.
 * SCR -> OSGi DS, :Boolean hint added, runOn scoped to LEADER.
 */
@Component(
        service = Runnable.class,
        immediate = true,
        property = {
                "scheduler.expression=*/30 * * * * ?",  // preserved from legacy @Property
                "scheduler.concurrent:Boolean=false",   // :Boolean type hint required
                "scheduler.runOn=LEADER"                 // was implicit ALL — scope to leader
        }
)
@Designate(ocd = SimpleScheduledTask.Config.class)
public class SimpleScheduledTask implements Runnable {

    private final Logger logger = LoggerFactory.getLogger(getClass());

    private String myParameter;

    @ObjectClassDefinition(name = "A scheduled task",
            description = "Simple demo for cron-job like task with properties")
    public @interface Config {
        @AttributeDefinition(name = "A parameter", description = "Configurable via OSGi config")
        String myParameter() default "";
    }

    @Override
    public void run() {
        logger.info("SimpleScheduledTask is now running, myParameter='{}'", myParameter);
    }

    @Activate
    @Modified
    protected void activate(final Config config) {
        this.myParameter = config.myParameter();
        logger.debug("configure: myParameter='{}'", myParameter);
    }
}
