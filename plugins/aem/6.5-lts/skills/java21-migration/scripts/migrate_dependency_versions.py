#!/usr/bin/env python3
"""
Dependency version migration script.

Updates dependency versions in pom.xml files based on a JSON configuration.
Handles both direct version strings and property-referenced versions.

Usage:
    python3 migrate_dependency_versions.py \
        --project-path /path/to/project \
        --config /path/to/dependency-migration.json
"""

import argparse
import json
import os
import re
import sys
import xml.etree.ElementTree as ET


def migrate_dependency_versions(project_path: str, config_path: str) -> bool:
    """Update dependency versions based on JSON config."""
    try:
        with open(config_path, "r") as f:
            config_entries = json.load(f)

        ns = {"m": "http://maven.apache.org/POM/4.0.0"}
        updated_count = 0

        for root_dir, _, files in os.walk(project_path):
            for file in files:
                if file != "pom.xml":
                    continue

                pom_path = os.path.join(root_dir, file)
                with open(pom_path, "r", encoding="utf-8") as f:
                    original_text = f.read()
                updated_text = original_text

                try:
                    tree = ET.ElementTree(ET.fromstring(original_text))
                    root = tree.getroot()
                except ET.ParseError:
                    print(f"Skipping {pom_path}, unable to parse.")
                    continue

                changed = False

                for entry in config_entries:
                    group_id = entry["groupId"]
                    artifact_id_pattern = entry["artifactId"].replace("*", ".*")
                    new_version = entry["newVersion"]
                    skip_artifacts = set(entry.get("skip", []))

                    for dependency in root.findall(".//m:dependency", ns):
                        group_elem = dependency.find("m:groupId", ns)
                        artifact_elem = dependency.find("m:artifactId", ns)
                        version_elem = dependency.find("m:version", ns)

                        if group_elem is None or artifact_elem is None:
                            continue

                        group_text = group_elem.text.strip()
                        artifact_text = artifact_elem.text.strip()

                        if artifact_text in skip_artifacts:
                            continue

                        if group_text != group_id:
                            continue

                        if not re.fullmatch(artifact_id_pattern, artifact_text):
                            continue

                        if version_elem is not None:
                            version_text = version_elem.text.strip()

                            if version_text.startswith("${") and version_text.endswith("}"):
                                property_name = version_text[2:-1]
                                pattern = rf"(<{property_name}>\s*)(.*?)(\s*</{property_name}>)"

                                def property_replacer(match, _nv=new_version, _pn=property_name, _pp=pom_path):
                                    old = match.group(2).strip()
                                    if old != _nv:
                                        print(f"{_pp}: Updating property {_pn} from {old} to {_nv}")
                                        return f"{match.group(1)}{_nv}{match.group(3)}"
                                    return match.group(0)

                                updated_text, num_subs = re.subn(
                                    pattern, property_replacer, updated_text
                                )
                                changed |= num_subs > 0
                            else:
                                pattern = (
                                    rf"(<artifactId>\s*{re.escape(artifact_text)}\s*</artifactId>"
                                    rf".*?<version>\s*)(.*?)(\s*</version>)"
                                )

                                def direct_replacer(match, _nv=new_version, _at=artifact_text, _pp=pom_path):
                                    old = match.group(2).strip()
                                    if old != _nv:
                                        print(f"{_pp}: Updating {_at} version from {old} to {_nv}")
                                        return f"{match.group(1)}{_nv}{match.group(3)}"
                                    return match.group(0)

                                updated_text, num_subs = re.subn(
                                    pattern, direct_replacer, updated_text, flags=re.DOTALL
                                )
                                changed |= num_subs > 0

                if changed and updated_text != original_text:
                    with open(pom_path, "w", encoding="utf-8") as f:
                        f.write(updated_text)
                    updated_count += 1

        print(f"Dependency version migration: Updated {updated_count} pom.xml files.")
        return True

    except Exception as e:
        print(f"Dependency version migration failed: {e}")
        return False


def main():
    parser = argparse.ArgumentParser(description="AEM dependency version migration")
    parser.add_argument("--project-path", required=True, help="Path to the AEM project root")
    parser.add_argument("--config", required=True, help="Path to dependency-migration.json")
    args = parser.parse_args()

    if not os.path.exists(os.path.join(args.project_path, "pom.xml")):
        print(f"ERROR: pom.xml not found at {args.project_path}")
        sys.exit(1)

    if not migrate_dependency_versions(args.project_path, args.config):
        sys.exit(1)


if __name__ == "__main__":
    main()
