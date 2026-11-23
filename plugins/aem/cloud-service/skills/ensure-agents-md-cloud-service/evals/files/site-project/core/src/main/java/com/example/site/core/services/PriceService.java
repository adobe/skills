package com.example.site.core.services;

import java.io.IOException;
import org.apache.http.client.methods.HttpGet;
import org.apache.http.impl.client.CloseableHttpClient;
import org.apache.http.impl.client.HttpClients;
import org.apache.http.util.EntityUtils;
import org.osgi.service.component.annotations.Component;

@Component(service = PriceService.class)
public class PriceService {

    private static final String PRICING_API = "https://pricing.example.com/v1/prices/";

    public String priceFor(String sku) throws IOException {
        try (CloseableHttpClient client = HttpClients.createSystem()) {
            return client.execute(new HttpGet(PRICING_API + sku), response -> EntityUtils.toString(response.getEntity()));
        }
    }
}
