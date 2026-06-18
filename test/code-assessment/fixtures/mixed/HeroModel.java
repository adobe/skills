package com.example.core.models;

import org.apache.sling.models.annotations.Model;
import javax.inject.Inject;

@Model(adaptables = org.apache.sling.api.resource.Resource.class)
public class HeroModel {
    @Inject
    private String title;
}
