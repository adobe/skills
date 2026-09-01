package com.adobe.aem.guides.core.repl;

import com.day.cq.replication.ReplicationActionType;
import com.day.cq.replication.Replicator;
import javax.jcr.Session;
import org.apache.sling.api.resource.ResourceResolver;

/** Legacy: CQ Replicator — not supported on AEM Cloud Service. */
public class ContentActivator {
    private Replicator replicator;
    public void activate(ResourceResolver resolver, String path) throws Exception {
        replicator.replicate(resolver.adaptTo(Session.class), ReplicationActionType.ACTIVATE, path);
    }
}
