package com.example.dam;

import com.day.cq.dam.api.Asset;
import com.day.cq.dam.api.AssetManager;
import java.io.InputStream;

public class LegacyAssetWorkflow {
    private AssetManager assetManager;

    public Asset upload(String path, InputStream stream, String mime) {
        // createAsset is the createAsset code-path that should move to Direct Binary Access
        return assetManager.createAsset(path, stream, mime, true);
    }

    public Asset uploadBinary(String path, String binary, String mime) {
        // createAssetForBinary is unavailable on Cloud Service — must migrate
        return assetManager.createAssetForBinary(path, binary, mime, true);
    }

    public void purge(String path) {
        // removeAssetForBinary is unavailable on Cloud Service — must migrate
        assetManager.removeAssetForBinary(path);
    }
}
