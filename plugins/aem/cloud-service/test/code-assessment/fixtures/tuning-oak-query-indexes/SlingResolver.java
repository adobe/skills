package com.example.core.search;

import org.apache.sling.api.resource.Resource;
import org.apache.sling.api.resource.ResourceResolver;

import java.util.Iterator;

/** Sling ResourceResolver query APIs — both findResources and queryResources must be flagged. */
public class SlingResolver {

    public Iterator<Resource> byXpath(ResourceResolver resolver) {
        String xpath = "/jcr:root/content//*[@jcr:primaryType='cq:Page']";
        return resolver.findResources(xpath, "xpath");
    }

    public Iterator<java.util.Map<String, Object>> bySql2(ResourceResolver resolver) {
        String sql2 = "SELECT * FROM [cq:Page] WHERE ISDESCENDANTNODE('/content')";
        return resolver.queryResources(sql2, "JCR-SQL2");
    }
}
