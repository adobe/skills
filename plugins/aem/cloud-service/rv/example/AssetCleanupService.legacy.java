package com.adobe.aem.guides.core.assets;

import com.day.cq.dam.api.AssetManager;
import org.apache.sling.api.resource.ResourceResolver;

/** Legacy: uses a removed AssetManager binary API (not available on AEMaaCS). */
public class AssetCleanupService {

    public void deleteAsset(ResourceResolver resolver, String binaryFilePath) {
        AssetManager assetManager = resolver.adaptTo(AssetManager.class);
        // removeAssetForBinary is REMOVED on Cloud Service (relied on a filesystem path)
        assetManager.removeAssetForBinary(binaryFilePath, true);
    }
}
