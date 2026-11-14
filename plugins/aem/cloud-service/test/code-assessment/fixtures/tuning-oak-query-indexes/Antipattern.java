package com.example.core.search;

import com.day.cq.search.PredicateGroup;
import com.day.cq.search.QueryBuilder;
import com.day.cq.search.result.SearchResult;

import javax.jcr.Session;
import javax.jcr.query.Query;
import javax.jcr.query.QueryManager;
import java.util.HashMap;
import java.util.Map;

/** Constructs both a JCR query and a QueryBuilder query — both must be flagged. */
public class Antipattern {

    public void jcrQuery(Session session) throws Exception {
        QueryManager queryManager = session.getWorkspace().getQueryManager();
        String statement = "SELECT * FROM [nt:base] WHERE [jcr:content/hasValidMetadata] = true";
        Query query = queryManager.createQuery(statement, "JCR-SQL2");
        query.execute();
    }

    public SearchResult builderQuery(QueryBuilder builder, Session session) {
        Map<String, String> map = new HashMap<>();
        map.put("path", "/content/dam");
        map.put("1_property", "jcr:content/metadata/status");
        map.put("1_property.value", "approved");
        return builder.createQuery(PredicateGroup.create(map), session).getResult();
    }
}
