package com.example.core.models;

import org.apache.sling.models.annotations.Model;
import org.apache.sling.models.annotations.injectorspecific.ValueMapValue;

@Model(adaptables = org.apache.sling.api.resource.Resource.class)
public class CleanModel {
    @ValueMapValue
    private String title;
}
