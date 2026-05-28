#!/usr/bin/env python3
"""
POM plugin migration script.

Performs three operations:
1. Updates maven-compiler-plugin configuration (source/target to 21)
2. Removes SCRDescriptorBndPlugin _plugin tags
3. Adds dependency classifiers (apis to uber-jar) in child POMs

Usage:
    python3 migrate_plugins.py \
        --project-path /path/to/project \
        --plugin-config /path/to/plugin-configuration.json \
        --classifier-config /path/to/dependency-classifier-migration.json
"""

import argparse
import json
import os
import re
import sys
import xml.etree.ElementTree as ET


def migrate_plugin_configurations(project_path: str, config_path: str) -> bool:
    """Update plugin configurations based on JSON config."""
    try:
        with open(config_path, "r") as f:
            config_entries = json.load(f)

        updated_count = 0

        for root_dir, _, files in os.walk(project_path):
            for file in files:
                if file != "pom.xml":
                    continue

                pom_path = os.path.join(root_dir, file)
                with open(pom_path, "r", encoding="utf-8") as f:
                    original_text = f.read()
                updated_text = original_text
                changed = False

                for entry in config_entries:
                    group_id = entry["groupId"]
                    artifact_id = entry["artifactId"]
                    config_updates = entry["configuration"]

                    plugin_pattern = (
                        rf"(<plugin>.*?<groupId>\s*{re.escape(group_id)}\s*</groupId>\s*"
                        rf"<artifactId>\s*{re.escape(artifact_id)}\s*</artifactId>.*?</plugin>)"
                    )

                    def plugin_config_replacer(match):
                        nonlocal updated_text
                        plugin_block = match.group(1)
                        new_block = plugin_block
                        for tag, target_value in config_updates.items():
                            tag_pattern = rf"<{tag}>\s*(.*?)\s*</{tag}>"

                            def tag_replacer(m):
                                current_value = m.group(1)
                                if current_value.startswith("${") and current_value.endswith("}"):
                                    prop_name = current_value[2:-1]
                                    prop_pattern = rf"(<{prop_name}>\s*)(.*?)(\s*</{prop_name}>)"

                                    def prop_replacer(pm):
                                        if pm.group(2) != target_value:
                                            print(f"{pom_path}: Updating property {prop_name} from {pm.group(2)} to {target_value}")
                                            return f"{pm.group(1)}{target_value}{pm.group(3)}"
                                        return pm.group(0)

                                    nonlocal updated_text
                                    updated_text, subs = re.subn(prop_pattern, prop_replacer, updated_text)
                                    return m.group(0)
                                elif current_value != target_value:
                                    print(f"{pom_path}: Updating <{tag}> from {current_value} to {target_value}")
                                    return f"<{tag}>{target_value}</{tag}>"
                                return m.group(0)

                            new_block, num_subs = re.subn(tag_pattern, tag_replacer, new_block)
                        if new_block != plugin_block:
                            return new_block
                        return match.group(0)

                    updated_text, subs = re.subn(
                        plugin_pattern, plugin_config_replacer, updated_text, flags=re.DOTALL
                    )
                    changed |= subs > 0

                if changed and updated_text != original_text:
                    with open(pom_path, "w", encoding="utf-8") as f:
                        f.write(updated_text)
                    updated_count += 1

        print(f"Plugin configuration: Updated {updated_count} pom.xml files.")
        return True

    except Exception as e:
        print(f"Plugin configuration migration failed: {e}")
        return False


def remove_scrplugin_lines(project_path: str) -> bool:
    """Remove _plugin tags containing SCRDescriptorBndPlugin."""
    removed_count = 0
    for root_dir, _, files in os.walk(project_path):
        for file in files:
            if file != "pom.xml":
                continue

            pom_path = os.path.join(root_dir, file)
            with open(pom_path, "r", encoding="utf-8") as f:
                original_text = f.read()

            pattern = r"\s*<_plugin>.*?SCRDescriptorBndPlugin.*?</_plugin>\s*\n?"
            updated_text, num_subs = re.subn(pattern, "", original_text, flags=re.DOTALL)

            if num_subs > 0:
                with open(pom_path, "w", encoding="utf-8") as f:
                    f.write(updated_text)
                removed_count += 1
                print(f"{pom_path}: Removed {num_subs} <_plugin> tag(s)")

    print(f"SCR plugin removal: Sanitized {removed_count} pom.xml file(s).")
    return True


def migrate_dependency_classifiers(project_path: str, config_path: str) -> bool:
    """Add classifiers to dependencies based on configuration."""
    try:
        with open(config_path, "r") as f:
            config_entries = json.load(f)

        ns = {"m": "http://maven.apache.org/POM/4.0.0"}
        updated_count = 0

        def get_parent_dependencies(parent_pom_path):
            parent_dependencies = {}
            if os.path.exists(parent_pom_path):
                try:
                    with open(parent_pom_path, "r", encoding="utf-8") as f:
                        parent_text = f.read()
                    parent_tree = ET.ElementTree(ET.fromstring(parent_text))
                    parent_root = parent_tree.getroot()

                    for dep_mgmt in parent_root.findall(".//m:dependencyManagement/m:dependencies", ns):
                        for dep in dep_mgmt.findall("m:dependency", ns):
                            dep_group_id = dep.find("m:groupId", ns)
                            dep_artifact_id = dep.find("m:artifactId", ns)
                            dep_classifier = dep.find("m:classifier", ns)

                            if dep_group_id is not None and dep_artifact_id is not None and dep_classifier is not None:
                                key = (dep_group_id.text.strip(), dep_artifact_id.text.strip())
                                parent_dependencies[key] = dep_classifier.text.strip()
                except ET.ParseError:
                    print(f"Warning: Could not parse parent POM {parent_pom_path}")
            return parent_dependencies

        def find_immediate_parent_pom(pom_path):
            pom_dir = os.path.dirname(pom_path)
            parent_dir = os.path.dirname(pom_dir)
            immediate_parent_pom = os.path.join(parent_dir, "pom.xml")

            if not os.path.exists(immediate_parent_pom):
                current_dir = parent_dir
                while current_dir != project_path and current_dir != "/":
                    parent_pom_candidate = os.path.join(current_dir, "pom.xml")
                    if os.path.exists(parent_pom_candidate):
                        immediate_parent_pom = parent_pom_candidate
                        break
                    current_dir = os.path.dirname(current_dir)

            return immediate_parent_pom

        all_poms = []
        for root_dir, _, files in os.walk(project_path):
            for file in files:
                if file != "pom.xml":
                    continue
                pom_path = os.path.join(root_dir, file)
                if pom_path == os.path.join(project_path, "pom.xml"):
                    continue
                relative_path = os.path.relpath(pom_path, project_path)
                depth = len(relative_path.split(os.sep)) - 1
                all_poms.append((depth, pom_path))

        all_poms.sort(key=lambda x: x[0])

        for depth, pom_path in all_poms:
            with open(pom_path, "r", encoding="utf-8") as f:
                original_text = f.read()

            try:
                tree = ET.ElementTree(ET.fromstring(original_text))
                root = tree.getroot()
            except ET.ParseError:
                print(f"Skipping {pom_path}, unable to parse.")
                continue

            immediate_parent_pom = find_immediate_parent_pom(pom_path)
            parent_dependencies = get_parent_dependencies(immediate_parent_pom)

            changed = False

            for entry in config_entries:
                group_id = entry["groupId"]
                artifact_id = entry["artifactId"]
                target_classifier = entry["classifier"]

                parent_key = (group_id, artifact_id)
                if parent_key not in parent_dependencies:
                    continue
                if parent_dependencies[parent_key] != target_classifier:
                    continue

                for deps_tag in root.findall(".//m:dependencies", ns):
                    for dep in deps_tag.findall("m:dependency", ns):
                        dep_group_id = dep.find("m:groupId", ns)
                        dep_artifact_id = dep.find("m:artifactId", ns)

                        if dep_group_id is None or dep_artifact_id is None:
                            continue

                        if dep_group_id.text.strip() == group_id and dep_artifact_id.text.strip() == artifact_id:
                            dep_version = dep.find("m:version", ns)
                            if dep_version is not None:
                                continue

                            classifier = dep.find("m:classifier", ns)
                            if classifier is None:
                                dep_pattern = (
                                    rf"(<dependency>\s*"
                                    rf"<groupId>\s*{re.escape(group_id)}\s*</groupId>\s*"
                                    rf"<artifactId>\s*{re.escape(artifact_id)}\s*</artifactId>)"
                                    rf"(\s*</dependency>)"
                                )

                                def add_classifier_replacer(match):
                                    return f"{match.group(1)}\n        <classifier>{target_classifier}</classifier>{match.group(2)}"

                                updated_text, num_subs = re.subn(
                                    dep_pattern, add_classifier_replacer, original_text, flags=re.DOTALL
                                )

                                if num_subs > 0:
                                    print(f"{pom_path}: Added classifier '{target_classifier}' to {artifact_id}")
                                    original_text = updated_text
                                    changed = True

            if changed:
                with open(pom_path, "w", encoding="utf-8") as f:
                    f.write(original_text)
                updated_count += 1

        print(f"Classifier migration: Updated {updated_count} pom.xml files.")
        return True

    except Exception as e:
        print(f"Dependency classifier migration failed: {e}")
        return False


def main():
    parser = argparse.ArgumentParser(description="AEM POM plugin migration")
    parser.add_argument("--project-path", required=True, help="Path to the AEM project root")
    parser.add_argument("--plugin-config", required=True, help="Path to plugin-configuration.json")
    parser.add_argument("--classifier-config", required=True, help="Path to dependency-classifier-migration.json")
    args = parser.parse_args()

    if not os.path.exists(os.path.join(args.project_path, "pom.xml")):
        print(f"ERROR: pom.xml not found at {args.project_path}")
        sys.exit(1)

    success = True

    print("=== Step 1/3: Migrating plugin configurations ===")
    if not migrate_plugin_configurations(args.project_path, args.plugin_config):
        success = False

    print("\n=== Step 2/3: Removing SCR plugin lines ===")
    if not remove_scrplugin_lines(args.project_path):
        success = False

    print("\n=== Step 3/3: Migrating dependency classifiers ===")
    if not migrate_dependency_classifiers(args.project_path, args.classifier_config):
        success = False

    if success:
        print("\nAll plugin migrations completed successfully.")
    else:
        print("\nSome plugin migrations failed. Check output above.")
        sys.exit(1)


if __name__ == "__main__":
    main()
