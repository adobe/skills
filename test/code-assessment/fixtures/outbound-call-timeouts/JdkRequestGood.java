package com.example.core.http;

import java.net.URI;
import java.net.http.HttpRequest;
import java.time.Duration;

// Safe: per-request read timeout set on the chain — must NOT flag.
public class JdkRequestGood {
    public HttpRequest build(URI uri) {
        return HttpRequest.newBuilder(uri)
                .timeout(Duration.ofSeconds(8))
                .GET()
                .build();
    }
}
