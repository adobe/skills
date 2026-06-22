package analyzer;

import analyzer.detectors.InjectInSlingModel;
import analyzer.detectors.OutdatedDependencies;

import java.util.ArrayList;
import java.util.Arrays;
import java.util.List;

public final class Registry {
    private Registry() {}
    public static List<Detector> all() {
        return new ArrayList<>(Arrays.asList(
            new InjectInSlingModel(),
            new OutdatedDependencies()
        ));
    }
}
