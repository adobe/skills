package com.example.core.http;

import com.other.http.HttpRequest;

// A non-JDK HttpRequest type (different import) — the JDK request facet must NOT flag it.
public class OtherHttpRequest {
    public HttpRequest build() {
        return HttpRequest.newBuilder().build();
    }
}
