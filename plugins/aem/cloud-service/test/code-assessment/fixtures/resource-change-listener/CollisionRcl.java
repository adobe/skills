package com.example.observation;

import com.acme.observation.ResourceChangeListener;

// Same simple name "ResourceChangeListener" from a non-Sling package — must NOT be flagged.
public class CollisionRcl implements ResourceChangeListener {
    public void onChange(Object changes) { }
}
