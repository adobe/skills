package com.example.core.search;

import java.util.HashMap;
import java.util.Map;
import javax.jcr.query.Query;

// Safe: a real bound is set, and a -1 on a different key/limit is not the unbounded marker.
public class BoundedQuery {
    private static final String PAGE = "100";   // bounded constant → clean

    public Map<String, String> predicates() {
        Map<String, String> params = new HashMap<>();
        params.put("p.limit", PAGE);       // bounded via constant → clean
        params.put("p.offset", "0");
        params.put("some.flag", "-1");     // -1 but not p.limit → clean
        return params;
    }

    public void run(Query query) {
        query.setLimit(100);               // bounded → clean
    }
}
