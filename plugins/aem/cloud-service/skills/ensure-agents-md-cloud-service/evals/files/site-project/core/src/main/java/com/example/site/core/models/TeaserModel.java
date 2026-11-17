package com.example.site.core.models;

import javax.inject.Inject;
import org.apache.sling.api.resource.Resource;
import org.apache.sling.models.annotations.Model;

@Model(adaptables = Resource.class)
public class TeaserModel {

    @Inject
    private String title;

    public String getTitle() {
        return title;
    }
}
