package fixtures;

import io.micrometer.core.instrument.binder.cache.GuavaCacheMetrics;

/**
 * Negative / false-positive guard: a look-alike "GuavaCache" class from a different package
 * (Micrometer's metrics binder, not com.google.common.cache.*). Must NOT be flagged — the BPA
 * report's known guava false positive.
 */
public class MicrometerGuavaMetrics {

    public Class<?> binder() {
        return GuavaCacheMetrics.class;
    }
}
