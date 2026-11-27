package com.acme.core;

import com.adobe.acs.commons.genericlists.GenericList;

public class CountryList {
    private final GenericList list;

    public CountryList(GenericList list) {
        this.list = list;
    }

    public String title(String value) {
        return list.lookupTitle(value);
    }
}
