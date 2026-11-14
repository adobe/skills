package com.example.core.http;

import java.net.http.HttpClient;

// Antipattern: JDK HttpClient.newHttpClient() has no connect timeout (default is infinite) — must flag.
public class JdkHttpService {
    public HttpClient client() {
        return HttpClient.newHttpClient();
    }
}
