package com.example.core.services;

import org.apache.sling.api.resource.LoginException;
import org.apache.sling.api.resource.ResourceResolver;
import org.apache.sling.api.resource.ResourceResolverFactory;

public class AdminFactoryCaller {

    private ResourceResolverFactory factory;

    public ResourceResolver legacyAdmin() throws LoginException {
        return factory.getAdministrativeResourceResolver(null);
    }

    public ResourceResolver legacyLoginAdmin() throws LoginException {
        return factory.loginAdministrative(null);
    }

    // A mention in a comment or string is not a call: factory.getAdministrativeResourceResolver(null)
    public String describe() {
        return "do not call loginAdministrative(null)";
    }
}
