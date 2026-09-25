package com.example.core.search;

import javax.jcr.query.Query;
import javax.jcr.query.QueryManager;

/**
 * Wrapper/DAO whose BODY contains the real JCR API call. The construction site inside the wrapper IS
 * flagged (parse-level match on the written `createQuery` call). The detector has no call graph, so it
 * flags this once — it does not trace the wrapper's callers (see WrapperCaller) or follow a wrapper that
 * hides the query API in code outside the scanned corpus (see OpaqueDao).
 */
public class Wrapper {

    private QueryManager queryManager;

    public Query buildQuery(String statement) throws Exception {
        return queryManager.createQuery(statement, "JCR-SQL2");
    }
}
