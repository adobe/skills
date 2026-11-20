package com.example.core.services;

import java.util.Map;
import org.apache.sling.api.resource.LoginException;
import org.apache.sling.api.resource.ResourceResolver;
import org.apache.sling.api.resource.ResourceResolverFactory;

public class CleanServiceUser {

    private ResourceResolverFactory factory;

    public ResourceResolver reader() throws LoginException {
        return factory.getServiceResourceResolver(
            Map.of(ResourceResolverFactory.SUBSERVICE, "site-reader"));
    }
}
