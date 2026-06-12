package com.example.core.search;

import java.util.HashMap;
import java.util.Map;

// Antipattern: QueryBuilder predicate map declares no bound — p.limit = -1 → must flag.
public class UnboundedQuery {
    public Map<String, String> predicates() {
        Map<String, String> params = new HashMap<>();
        params.put("p.path", "/content/example");
        params.put("p.limit", "-1");
        return params;
    }
}
