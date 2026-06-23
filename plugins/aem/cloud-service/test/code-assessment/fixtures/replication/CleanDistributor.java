package com.example.replication;

import org.apache.sling.distribution.Distributor;

// Uses the modern Sling Distribution API — must NOT be flagged.
public class CleanDistributor {
    private Distributor distributor;
    public void publish(String path) { }
}
