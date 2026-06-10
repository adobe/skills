package com.example.core.http;

import org.apache.http.impl.client.CloseableHttpClient;
import org.apache.http.impl.client.HttpClients;

// Antipattern: Apache HttpClient built with no timeout configured anywhere in scope.
public class BadHttpService {
    public String fetch() throws Exception {
        CloseableHttpClient client = HttpClients.createDefault();
        return client.execute(null, response -> "ok");
    }
}
