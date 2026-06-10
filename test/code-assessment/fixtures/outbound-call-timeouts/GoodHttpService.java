package com.example.core.http;

import org.apache.http.client.config.RequestConfig;
import org.apache.http.impl.client.CloseableHttpClient;
import org.apache.http.impl.client.HttpClientBuilder;

// Safe: connect + socket timeouts set via RequestConfig in the same scope as the build() — must NOT flag.
public class GoodHttpService {
    public CloseableHttpClient client() {
        RequestConfig config = RequestConfig.custom()
                .setConnectTimeout(3000)
                .setSocketTimeout(8000)
                .setConnectionRequestTimeout(2000)
                .build();
        return HttpClientBuilder.create()
                .setDefaultRequestConfig(config)
                .build();
    }
}
