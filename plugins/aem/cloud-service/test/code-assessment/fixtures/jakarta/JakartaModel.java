package com.example.core.models;

import org.apache.sling.models.annotations.Model;
import jakarta.inject.Inject;

@Model(adaptables = org.apache.sling.api.resource.Resource.class)
public class JakartaModel {
    @Inject
    private String title;
}
