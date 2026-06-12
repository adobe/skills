package analyzer;

import analyzer.detectors.InjectInSlingModel;
import analyzer.detectors.OutboundCallTimeouts;
import analyzer.detectors.OutdatedDependencies;
import analyzer.detectors.UnboundedQuery;

import java.util.ArrayList;
import java.util.Arrays;
import java.util.List;

public final class Registry {
    private Registry() {}
    public static List<Detector> all() {
        return new ArrayList<>(Arrays.asList(
            new InjectInSlingModel(),
            new OutboundCallTimeouts(),
            new OutdatedDependencies(),
            new UnboundedQuery()
        ));
    }
}
