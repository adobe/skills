package com.example.core.search;

/**
 * A wrapper that hides the query API entirely: the real repository query runs inside `gateway.execute`,
 * which lives in another module not part of this scan. No JCR/Sling/QueryBuilder API is written in this
 * file, so the detector finds nothing here — an inherent parse-level limit, not a bug.
 */
public class OpaqueDao {

    private SearchGateway gateway;

    public Object report(String q) {
        return gateway.execute(q);
    }

    interface SearchGateway {
        Object execute(String q);
    }
}
