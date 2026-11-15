package com.example.core.http;

import org.apache.http.impl.client.CloseableHttpClient;
import org.apache.http.impl.client.HttpClients;

// Antipattern: HttpClients.createMinimal() with no timeout configured anywhere in scope.
public class MinimalHttpService {
    public String fetch() throws Exception {
        CloseableHttpClient client = HttpClients.createMinimal();
        return client.execute(null, response -> "ok");
    }
}
