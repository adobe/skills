package com.example.observation;

import org.apache.sling.api.resource.observation.ExternalResourceChangeListener;
import org.apache.sling.api.resource.observation.ResourceChange;
import java.util.List;

// ExternalResourceChangeListener (cluster-wide variant, extends ResourceChangeListener) — also flagged.
public class ExternalRclListener implements ExternalResourceChangeListener {
    public void onChange(List<ResourceChange> changes) { }
}
