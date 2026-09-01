package com.adobe.aem.guides.core.repl;

import org.apache.sling.api.resource.ResourceResolver;
import org.apache.sling.distribution.DistributionRequestType;
import org.apache.sling.distribution.Distributor;
import org.apache.sling.distribution.SimpleDistributionRequest;

/** Migrated: Sling Distribution API (Distributor + SimpleDistributionRequest). */
public class ContentActivator {
    private Distributor distributor;
    public void activate(ResourceResolver resolver, String path) {
        distributor.distribute("publish", resolver,
                new SimpleDistributionRequest(DistributionRequestType.ADD, path));
    }
}
