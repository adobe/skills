package com.example.core.http;

import org.apache.http.impl.client.CloseableHttpClient;
import org.apache.http.impl.client.HttpClients;

// Antipattern: HttpClients.createSystem() honours the proxy system properties but sets no timeout.
public class SystemHttpService {
    public String fetch() throws Exception {
        CloseableHttpClient client = HttpClients.createSystem();
        return client.execute(null, response -> "ok");
    }
}
