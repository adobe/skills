package com.example.core.services;

import java.util.HashMap;
import java.util.Map;

// AUTH_ADMIN here is the project's own constant, not Sling's ResourceProvider.AUTH_ADMIN.
public class UnrelatedAuthAdmin {

    static final class MyAuth {
        static final String AUTH_ADMIN = "my.auth.admin";
    }

    public Map<String, Object> info() {
        Map<String, Object> authInfo = new HashMap<>();
        authInfo.put(MyAuth.AUTH_ADMIN, Boolean.TRUE);
        return authInfo;
    }
}
