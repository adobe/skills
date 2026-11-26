package com.example.core;

import java.io.File;
import java.io.FileInputStream;
import java.io.IOException;
import java.io.InputStream;
import java.util.Properties;

/** Reads the feed settings file left over from the AEM 6.5 importer job. */
public class FeedImporter {

    public Properties loadSettings(File settingsFile) throws IOException {
        Properties settings = new Properties();
        InputStream in = new FileInputStream(settingsFile);
        settings.load(in);
        return settings;
    }

    public int batchSize(Properties settings) {
        String value = settings.getProperty("batchSize");
        if (value == null || value.isEmpty()) {
            return 50;
        }
        return Integer.parseInt(value);
    }
}
