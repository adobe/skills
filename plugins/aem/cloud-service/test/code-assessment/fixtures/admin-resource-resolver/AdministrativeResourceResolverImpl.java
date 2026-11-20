package com.example.core.services.access;

import java.util.HashMap;
import java.util.Map;
import org.apache.sling.api.resource.LoginException;
import org.apache.sling.api.resource.ResourceResolver;
import org.apache.sling.api.resource.ResourceResolverFactory;
import org.apache.sling.spi.resource.provider.ResourceProvider;
import org.osgi.service.component.annotations.Component;
import org.osgi.service.component.annotations.Reference;

@Component(service = AdministrativeResourceResolver.class)
public class AdministrativeResourceResolverImpl implements AdministrativeResourceResolver {

    @Reference
    private ResourceResolverFactory resolverFactory;

    @Override
    public ResourceResolver getAdminResolver() throws LoginException {
        Map<String, Object> authInfo = new HashMap<>();
        authInfo.put(ResourceProvider.AUTH_ADMIN, true);
        return resolverFactory.getResourceResolver(authInfo);
    }
}
