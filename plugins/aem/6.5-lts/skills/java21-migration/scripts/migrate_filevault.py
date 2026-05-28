#!/usr/bin/env python3
"""
FileVault embedded groupId migration script.

Updates the groupId of embedded artifacts matching a prefix inside
filevault-package-maven-plugin configurations across all pom.xml files.

Usage:
    python3 migrate_filevault.py \
        --project-path /path/to/project \
        --artifact-prefix "aem-groovy-console" \
        --new-group-id "be.orbinson.aem"
"""

import argparse
import os
import re
import sys
import xml.etree.ElementTree as ET


def migrate_filevault_embedded_group_id(
    project_path: str, artifact_prefix: str, new_group_id: str
) -> bool:
    """Update FileVault embedded groupId for matching artifacts."""
    ns = {"m": "http://maven.apache.org/POM/4.0.0"}
    ET.register_namespace("", ns["m"])

    updated_count = 0
    FILE_VAULT_GROUP_ID = "org.apache.jackrabbit"
    FILE_VAULT_ARTIFACT_ID = "filevault-package-maven-plugin"

    for root_dir, _, files in os.walk(project_path):
        for file in files:
            if file != "pom.xml":
                continue

            pom_path = os.path.join(root_dir, file)
            with open(pom_path, "r", encoding="utf-8") as f:
                original_text = f.read()

            try:
                tree = ET.ElementTree(ET.fromstring(original_text))
                root = tree.getroot()
            except ET.ParseError:
                print(f"Skipping {pom_path}, unable to parse.")
                continue

            for plugin in root.findall(".//m:plugin", ns):
                gid = plugin.find("m:groupId", ns)
                aid = plugin.find("m:artifactId", ns)

                if gid is None or aid is None:
                    continue

                if (
                    gid.text.strip() != FILE_VAULT_GROUP_ID
                    or aid.text.strip() != FILE_VAULT_ARTIFACT_ID
                ):
                    continue

                config = plugin.find("m:configuration", ns)
                if config is None:
                    continue

                embeddeds = config.find("m:embeddeds", ns)
                if embeddeds is None:
                    continue

                for embedded in embeddeds.findall("m:embedded", ns):
                    embedded_aid = embedded.find("m:artifactId", ns)
                    embedded_gid = embedded.find("m:groupId", ns)

                    if embedded_aid is None or embedded_gid is None:
                        continue

                    artifact_id = embedded_aid.text.strip()
                    group_id = embedded_gid.text.strip()

                    clean_prefix = artifact_prefix.rstrip("*")
                    if artifact_id.startswith(clean_prefix) and group_id != new_group_id:
                        print(
                            f"{pom_path}: Updating groupId of '{artifact_id}' "
                            f"from '{group_id}' to '{new_group_id}'"
                        )

                        pattern = (
                            rf"(<artifactId>\s*{re.escape(artifact_id)}\s*</artifactId>"
                            rf"\s*<groupId>\s*){re.escape(group_id)}(\s*</groupId>)"
                        )

                        updated_text, num_subs = re.subn(
                            pattern,
                            rf"\1{new_group_id}\2",
                            original_text,
                            flags=re.DOTALL,
                        )
                        if num_subs > 0:
                            with open(pom_path, "w", encoding="utf-8") as f:
                                f.write(updated_text)
                            updated_count += 1
                            break

    print(f"FileVault migration: Updated {updated_count} pom.xml files.")
    return True


def main():
    parser = argparse.ArgumentParser(description="FileVault embedded groupId migration")
    parser.add_argument("--project-path", required=True, help="Path to the AEM project root")
    parser.add_argument("--artifact-prefix", required=True, help="Artifact prefix to match (e.g., aem-groovy-console)")
    parser.add_argument("--new-group-id", required=True, help="New groupId to set (e.g., be.orbinson.aem)")
    args = parser.parse_args()

    if not os.path.exists(os.path.join(args.project_path, "pom.xml")):
        print(f"ERROR: pom.xml not found at {args.project_path}")
        sys.exit(1)

    if not migrate_filevault_embedded_group_id(
        args.project_path, args.artifact_prefix, args.new_group_id
    ):
        sys.exit(1)


if __name__ == "__main__":
    main()
