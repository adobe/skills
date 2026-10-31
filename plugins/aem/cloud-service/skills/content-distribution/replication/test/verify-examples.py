"""Compile selected complete Markdown examples against real, caller-supplied API JARs."""
import argparse
import pathlib
import re
import subprocess

parser = argparse.ArgumentParser()
parser.add_argument("--sdk-jar", type=pathlib.Path, required=True)
parser.add_argument("--lts-jar", type=pathlib.Path, required=True)
parser.add_argument("--annotations-jar", type=pathlib.Path, required=True)
parser.add_argument("--work-dir", type=pathlib.Path, required=True)
args = parser.parse_args()
root = pathlib.Path(__file__).resolve().parents[7]
cloud = root / "plugins/aem/cloud-service/skills/content-distribution/replication/SKILL.md"
lts = root / "plugins/aem/6.5-lts/skills/aem-replication/references/replication-foundation/queue-mechanics.md"
assessment = root / "plugins/aem/cloud-service/skills/code-assessment/replication/SKILL.md"
failed = False
for tier, document, jar, classes in [
    ("cloud", cloud, args.sdk_jar, [
        "ContentPublisher", "BulkPublisher", "PreviewPublisher", "SynchronousPublisher",
        "StatusChecker",
    ]),
    ("lts", lts, args.lts_jar, ["QueueMonitorListener", "MonitoredPublisher"]),
    ("assessment", assessment, args.sdk_jar, ["ContentReplicationService"]),
]:
    text = document.read_text()
    directory = args.work_dir / tier
    directory.mkdir(parents=True, exist_ok=True)
    sources = []
    for name in classes:
        blocks = [code for code in re.findall(r"```java\n(.*?)```", text, re.S)
                  if re.search(r"public class " + name + r"\b", code)]
        if tier == "assessment":
            blocks = [code for code in blocks if "getAdministrativeResourceResolver" not in code]
        if len(blocks) != 1:
            print(f"FAIL {tier}: expected one complete {name} example")
            failed = True
            continue
        source = directory / (name + ".java")
        source.write_text(blocks[0])
        sources.append(str(source))
    classpath = str(jar.resolve()) + ":" + str(args.annotations_jar.resolve())
    result = subprocess.run(["javac", "-Xlint:deprecation", "-cp", classpath,
                             "-d", str(directory), *sources], capture_output=True, text=True)
    print(f"{tier}: javac exit {result.returncode}; {len(sources)} Markdown examples")
    print(result.stdout + result.stderr, end="")
    failed |= result.returncode != 0
raise SystemExit(1 if failed else 0)
