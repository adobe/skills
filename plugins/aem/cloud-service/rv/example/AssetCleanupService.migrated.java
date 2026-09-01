package com.adobe.aem.guides.core.assets;

import org.apache.sling.api.resource.PersistenceException;
import org.apache.sling.api.resource.Resource;
import org.apache.sling.api.resource.ResourceResolver;

/** Migrated: in-JVM delete via resolver.delete() + commit() (Asset Manager Path B). */
public class AssetCleanupService {

    public void deleteAsset(ResourceResolver resolver, String repoPath) throws PersistenceException {
        Resource asset = resolver.getResource(repoPath);
        if (asset != null) {
            resolver.delete(asset);
            resolver.commit();
        }
    }
}
