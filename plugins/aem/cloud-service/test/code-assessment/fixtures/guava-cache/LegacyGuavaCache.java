package fixtures;

import com.google.common.cache.CacheBuilder;
import com.google.common.cache.CacheLoader;
import com.google.common.cache.LoadingCache;

import java.util.concurrent.TimeUnit;

/** Antipattern: imports com.google.common.cache.* — must be flagged by guava-cache. */
public class LegacyGuavaCache {

    private final LoadingCache<String, String> titles = CacheBuilder.newBuilder()
            .maximumSize(10_000)
            .expireAfterWrite(10, TimeUnit.MINUTES)
            .build(new CacheLoader<String, String>() {
                @Override
                public String load(String id) {
                    return resolve(id);
                }
            });

    public String title(String id) {
        return titles.getUnchecked(id);
    }

    private String resolve(String id) {
        return id.toUpperCase();
    }
}
