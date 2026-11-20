package com.example.core.services;

import static org.apache.sling.spi.resource.provider.ResourceProvider.AUTH_ADMIN;

import java.util.HashMap;
import java.util.Map;

public class StaticImportAdmin {

    public Map<String, Object> adminAuthInfo() {
        Map<String, Object> authInfo = new HashMap<>();
        authInfo.put(AUTH_ADMIN, Boolean.TRUE);
        return authInfo;
    }
}
