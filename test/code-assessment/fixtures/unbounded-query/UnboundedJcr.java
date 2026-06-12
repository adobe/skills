package com.example.core.search;

import javax.jcr.query.Query;

// Antipattern: JCR query limit set to -1 (unbounded) → must flag.
public class UnboundedJcr {
    public void run(Query query) {
        query.setLimit(-1);
    }
}
