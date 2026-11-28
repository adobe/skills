package com.example.site.core.services;

import org.apache.sling.api.resource.LoginException;
import org.apache.sling.api.resource.Resource;
import org.apache.sling.api.resource.ResourceResolver;
import org.apache.sling.api.resource.ResourceResolverFactory;
import org.osgi.service.component.annotations.Component;
import org.osgi.service.component.annotations.Reference;

@Component(service = LegacyReportService.class)
public class LegacyReportService {
    @Reference
    private ResourceResolverFactory resolverFactory;

    public String readReportTitle() throws LoginException {
        try (ResourceResolver resolver = resolverFactory.getAdministrativeResourceResolver(null)) {
            Resource report = resolver.getResource("/content/site/reports");
            return report.getValueMap().get("jcr:title", String.class);
        }
    }
}
