"""Apply compiler and narrowly scoped Maven plugin updates."""

import argparse
import re
import sys

from pom_support import (
    MigrationError, compiler_nodes, coordinate, inherited_plugin_version, load_config, minimum_version,
    plugins, reactor, resolve, target_config, update_setting, write_changes,
)


def plan(poms, target):
    config = load_config(target_config(target)["plugin_config"])
    for pom in poms.values():
        nodes = list(compiler_nodes(pom))
        for node in nodes:
            current = resolve(pom, node.data.strip(), poms, context=node)
            if not re.fullmatch(r"(?:1\.)?\d+", current):
                raise MigrationError(f"Unrecognized compiler version in {pom.path}: {current}")
            if int(current.removeprefix("1.")) > target:
                raise MigrationError(f"Compiler setting exceeds requested target in {pom.path}; refusing downgrade.")
            update_setting(pom, node, str(target), poms)
        for plugin in plugins(pom):
            rule = config.get(coordinate(plugin, "org.apache.maven.plugins"))
            if rule:
                version = plugin.child("version")
                if version:
                    minimum_version(pom, version, rule["minimum_version"], poms)
                elif inherited_plugin_version(pom, plugin, poms) is None:
                    pom.append(plugin, "version", rule["minimum_version"])
        if pom == next(iter(poms.values())) and not nodes:
            props = pom.root.child("properties")
            if props:
                pom.append(props, "maven.compiler.release", target)
            else:
                raise MigrationError("Root POM needs explicit compiler properties; inspect effective configuration.")


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
