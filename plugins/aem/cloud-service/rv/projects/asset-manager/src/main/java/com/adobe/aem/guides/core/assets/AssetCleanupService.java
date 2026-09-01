/*
 * RV — migrated Asset Manager code (Path B: in-JVM resolver.delete() + commit()).
 * Under test: this is what the asset-manager skill produces for AEMaaCS.
 */
package com.adobe.aem.guides.core.assets;

import org.apache.sling.api.resource.PersistenceException;
import org.apache.sling.api.resource.Resource;
import org.apache.sling.api.resource.ResourceResolver;
import org.osgi.service.component.annotations.Component;

@Component(service = AssetCleanupService.class, immediate = true)
public class AssetCleanupService {
    public boolean deleteAsset(ResourceResolver resolver, String repoPath) throws PersistenceException {
        Resource asset = resolver.getResource(repoPath);
        if (asset == null) return false;
        resolver.delete(asset);
        resolver.commit();
        return true;
    }
}
