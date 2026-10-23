package com.example.core.search;

/**
 * Callers of the wrapper. These run two distinct query shapes, but the call sites name `buildQuery`,
 * not a query API — so the detector does NOT flag them. Enumerating caller/trigger paths is the manual
 * job of the extracting-jcr-queries guide (Technique 1, caller tracing), not this parse-level detector.
 */
public class WrapperCaller {

    private Wrapper wrapper;

    public void pages() throws Exception {
        wrapper.buildQuery("SELECT * FROM [cq:Page]");
    }

    public void assets() throws Exception {
        wrapper.buildQuery("SELECT * FROM [dam:Asset]");
    }
}
