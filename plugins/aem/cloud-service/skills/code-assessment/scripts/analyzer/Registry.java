package analyzer;

import analyzer.detectors.AssetManager;
import analyzer.detectors.EventMigration;
import analyzer.detectors.InjectInSlingModel;
import analyzer.detectors.OutboundCallTimeouts;
import analyzer.detectors.OutdatedDependencies;
import analyzer.detectors.RemoveDeprecatedApi;
import analyzer.detectors.Replication;
import analyzer.detectors.ResourceChangeListener;
import analyzer.detectors.Scheduler;
import analyzer.detectors.UnboundedQuery;

import java.util.ArrayList;
import java.util.Arrays;
import java.util.List;

public final class Registry {
    private Registry() {}
    public static List<Detector> all() {
        return new ArrayList<>(Arrays.asList(
            new InjectInSlingModel(),
            new OutdatedDependencies(),
            new Scheduler(),
            new ResourceChangeListener(),
            new Replication(),
            new EventMigration(),
            new AssetManager(),
            new OutboundCallTimeouts(),
            new UnboundedQuery(),
            new RemoveDeprecatedApi()
        ));
    }
}
