package analyzer;

import java.util.List;

public interface Detector {
    String pattern();
    // which corpus types this detector consumes; main parses only what enabled detectors need
    default boolean needsJava() { return true; }
    default boolean needsPoms() { return true; }
    default boolean needsOsgi() { return false; }
    void detect(Corpus corpus, List<Finding> out, List<String> warnings);
}
