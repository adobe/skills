"""Upgrade declared FileVault plugins without weakening validators or package metadata."""

import argparse
import sys

from pom_support import MigrationError, coordinate, inherited_plugin_version, minimum_version, plugins, reactor, target_config, write_changes


def plan(poms, target):
    minimum = target_config(target)["filevault_minimum"]
    for pom in poms.values():
        for plugin in plugins(pom):
            if coordinate(plugin) != "org.apache.jackrabbit:filevault-package-maven-plugin":
                continue
            version = plugin.child("version")
            if version:
                minimum_version(pom, version, minimum, poms)
            elif inherited_plugin_version(pom, plugin, poms) is None:
                pom.append(plugin, "version", minimum)


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
