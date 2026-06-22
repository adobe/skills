package com.example.core.http;

import java.net.URI;
import java.net.http.HttpRequest;

// Antipattern: JDK HttpRequest built with no per-request read timeout — must flag.
public class JdkRequestBad {
    public HttpRequest build(URI uri) {
        return HttpRequest.newBuilder(uri).GET().build();
    }
}
