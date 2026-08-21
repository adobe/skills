package com.example.replication;

import com.day.cq.replication.Replicator;
import com.day.cq.replication.ReplicationActionType;
import javax.jcr.Session;

public class LegacyReplicator {
    private Replicator replicator;

    public void activate(Session session, String path) throws Exception {
        // legacy CQ Replicator — must migrate to Sling Distribution API
        replicator.replicate(session, ReplicationActionType.ACTIVATE, path);
    }
}
