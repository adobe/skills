package com.example.dam;

import com.acme.assets.AssetService;

// createAsset name collision on an unrelated service — must NOT be flagged
// (file does not import com.day.cq.dam.api.AssetManager).
public class UnrelatedCreateAsset {
    private AssetService service;
    public void run(String path) {
        service.createAsset(path);
    }
}
