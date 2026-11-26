package com.example.site.core.services;

import org.apache.sling.api.resource.LoginException;
import org.apache.sling.api.resource.PersistenceException;
import org.apache.sling.api.resource.Resource;
import org.apache.sling.api.resource.ResourceResolver;
import org.apache.sling.api.resource.ResourceResolverFactory;
import org.osgi.service.component.annotations.Component;
import org.osgi.service.component.annotations.Reference;

@Component(service = LegacyCleanupService.class)
public class LegacyCleanupService {
    @Reference
    private ResourceResolverFactory resolverFactory;

    public void removeExpiredReport() throws LoginException, PersistenceException {
        try (ResourceResolver resolver = resolverFactory.getAdministrativeResourceResolver(null)) {
            Resource expired = resolver.getResource("/var/site/reports/expired");
            if (expired != null) {
                resolver.delete(expired);
                resolver.commit();
            }
        }
    }
}
