package com.example.core.search;

import java.util.ArrayList;
import java.util.List;

/**
 * Near-miss names that must NOT be flagged: the detector matches exact query-API names only, so
 * differently-named methods, `create` on a non-PredicateGroup receiver, and unrelated constructors
 * stay clean.
 */
public class Negatives {

    interface Factory { Object create(String key); }

    public Object notPredicateGroupCreate(Factory factory) {
        return factory.create("x");                 // create() on a non-PredicateGroup receiver
    }

    public List<String> notAQuery() {
        List<String> list = new ArrayList<>();       // unrelated constructor
        list.add("createQueryBuilder");              // method name is a substring, not an exact match
        return list;
    }

    public String createQueryString() {              // declaration named createQuery* — not an invocation
        return "SELECT * FROM [nt:base]";
    }

    public int findResourcesCount(int a, int b) {    // findResources* substring, different name
        return a + b;
    }
}
