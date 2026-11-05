"""Update only configured dependency coordinates and known obsolete classifiers."""

import argparse
import sys

from pom_support import (
    MigrationError, coordinate, load_config, minimum_version, reactor,
    resolve, target_config, write_changes,
)


def plan(poms, target):
    target_config(target)
    versions = load_config("dependency-migration.json")
    classifiers = load_config("dependency-classifier-migration.json")
    for pom in poms.values():
        for dep in pom.root.walk("dependency"):
            key = coordinate(dep)
            version = dep.child("version")
            if key in versions and version:
                minimum_version(pom, version, versions[key], poms)
            classifier = dep.child("classifier")
            if classifier and key in classifiers:
                value = resolve(pom, classifier.data.strip(), poms, context=classifier)
                rule = classifiers[key]
                if value in rule["remove"]:
                    if not version or resolve(pom, version.data.strip(), poms, context=version) not in rule["verified_unclassified_versions"]:
                        raise MigrationError(f"Unverified unclassified artifact version for {key} in {pom.path}; review manually.")
                    pom.replace(classifier.start, classifier.end, b"")


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("project")
    parser.add_argument("--target", required=True, type=int)
    args = parser.parse_args()
    try:
        poms = reactor(args.project)
        plan(poms, args.target)
        print("\n".join(write_changes(poms)) or "No changes")
    except (MigrationError, OSError) as exc:
        print(f"ERROR: {exc}", file=sys.stderr)
        return 1
    return 0


if __name__ == "__main__":
    sys.exit(main())
