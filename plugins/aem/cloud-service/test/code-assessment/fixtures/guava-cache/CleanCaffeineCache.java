package fixtures;

import com.github.benmanes.caffeine.cache.Caffeine;
import com.github.benmanes.caffeine.cache.LoadingCache;

import java.time.Duration;

/** Clean: already migrated to Caffeine — must NOT be flagged by guava-cache. */
public class CleanCaffeineCache {

    private final LoadingCache<String, String> titles = Caffeine.newBuilder()
            .maximumSize(10_000)
            .expireAfterWrite(Duration.ofMinutes(10))
            .build(this::resolve);

    public String title(String id) {
        return titles.get(id);
    }

    private String resolve(String id) {
        return id.toUpperCase();
    }
}
