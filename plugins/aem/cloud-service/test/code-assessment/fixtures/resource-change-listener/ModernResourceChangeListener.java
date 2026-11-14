package com.example.observation;

import org.apache.sling.api.resource.observation.ResourceChange;
import org.apache.sling.api.resource.observation.ResourceChangeListener;
import java.util.List;

// Modern Sling ResourceChangeListener — flagged for review (must be lightweight + offload to JobConsumer).
public class ModernResourceChangeListener implements ResourceChangeListener {
    public void onChange(List<ResourceChange> changes) {
        // review: ensure no resolver/JCR/network work happens inline here
    }
}
