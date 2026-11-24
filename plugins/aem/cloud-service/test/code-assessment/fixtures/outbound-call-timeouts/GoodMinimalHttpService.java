package com.example.core.http;

import org.apache.http.client.config.RequestConfig;
import org.apache.http.client.methods.HttpGet;
import org.apache.http.impl.client.CloseableHttpClient;
import org.apache.http.impl.client.HttpClients;

// Safe: createMinimal() with a per-request RequestConfig in the same scope — must NOT flag.
public class GoodMinimalHttpService {
    public String fetch() throws Exception {
        RequestConfig config = RequestConfig.custom()
                .setConnectTimeout(3000)
                .setSocketTimeout(8000)
                .setConnectionRequestTimeout(2000)
                .build();
        HttpGet get = new HttpGet("https://example.com/");
        get.setConfig(config);
        CloseableHttpClient client = HttpClients.createMinimal();
        return client.execute(get, response -> "ok");
    }
}
