package com.example.core.search;

import com.day.cq.search.PredicateGroup;
import com.day.cq.search.QueryBuilder;
import com.day.cq.search.result.SearchResult;

import javax.jcr.Session;

/** QueryBuilder query built via the PredicateGroup constructor — both new PredicateGroup and createQuery flagged. */
public class QueryBuilderCtor {

    public SearchResult run(QueryBuilder builder, Session session) {
        PredicateGroup root = new PredicateGroup("root");
        return builder.createQuery(root, session).getResult();
    }
}
