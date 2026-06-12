package com.example.core.search;

import java.util.HashMap;
import java.util.Map;
import javax.jcr.query.Query;

// Antipattern: the unbounded marker reached through a same-file final constant — must flag.
public class UnboundedConst {
    private static final String UNLIMITED = "-1";
    private static final int NO_LIMIT = -1;

    public Map<String, String> predicates() {
        Map<String, String> params = new HashMap<>();
        params.put("p.limit", UNLIMITED);
        return params;
    }

    public void run(Query query) {
        query.setLimit(NO_LIMIT);
    }
}
