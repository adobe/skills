package com.example.core.http;

import org.apache.http.impl.client.CloseableHttpClient;
import org.apache.http.impl.client.HttpClientBuilder;
import org.mockito.Mockito;

// CA-12 regression: a Mockito stub of a builder must NOT be flagged as a timeout-less client.
// Old bug: bare "HttpClient" substring-matched the identifier `mockCloseableHttpClient` and the
// ".build(" marker matched `client.build()`, so the stub read as a client construction site.
public class MockitoStub {
    public void setUp(HttpClientBuilder client, CloseableHttpClient mockCloseableHttpClient) {
        Mockito.when(client.build()).thenReturn(mockCloseableHttpClient);
    }
}
