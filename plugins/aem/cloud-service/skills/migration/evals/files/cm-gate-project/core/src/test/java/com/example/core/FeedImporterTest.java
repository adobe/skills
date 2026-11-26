package com.example.core;

import static org.junit.jupiter.api.Assertions.assertEquals;

import java.util.Properties;
import org.junit.jupiter.api.Test;

class FeedImporterTest {

    @Test
    void defaultsBatchSizeWhenUnset() {
        assertEquals(50, new FeedImporter().batchSize(new Properties()));
    }
}
