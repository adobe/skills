package com.example.core.search;

import java.util.HashMap;
import java.util.Map;

/** Plain class with no query construction — must NOT be flagged. */
public class Clean {

    public String greeting(String name) {
        Map<String, String> map = new HashMap<>();
        map.put("greeting", "hello");
        return map.get("greeting") + ", " + name;
    }

    public int add(int a, int b) {
        return a + b;
    }
}
