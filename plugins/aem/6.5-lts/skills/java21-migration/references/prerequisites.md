# Prerequisites

## Required Tools

### Java Development Kits

The migration requires multiple JDK versions installed simultaneously:

| JDK | Purpose | Default Path | Env Override |
|-----|---------|-------------|--------------|
| JDK 8 | Build projects originally on Java 8 | `/usr/lib/jvm/jdk-8` | `JAVA8_HOME` |
| JDK 11 | Run OpenRewrite Java migration recipes, build Java 11 projects | `/usr/lib/jvm/jdk-11` | `JAVA11_HOME` |
| [JDK 21](https://adoptium.net/temurin/releases/?version=21) | Build migrated project, run Mockito migration | `/usr/lib/jvm/jdk-21` | `JAVA21_HOME` |

Verify installation:

```bash
$JAVA8_HOME/bin/java -version    # Should show 1.8.x
$JAVA11_HOME/bin/java -version   # Should show 11.x
$JAVA21_HOME/bin/java -version   # Should show 21.x
```

### Apache Maven

- Version: [3.9.x recommended](https://maven.apache.org/docs/3.9.0/release-notes.html)
- Verify: `mvn --version`
- The local repository defaults to `$M2_HOME/repository` (where `M2_HOME` defaults to `~/.m2`)

### Migration Tool (Java)

The migration tool is a two-module Maven project included in this skill:

- `aem65lts-migration-recipes/` — Custom OpenRewrite recipes (JAR)
- `aem65lts-migration-cli/` — picocli CLI tool (shaded JAR)

Build the tool before running migration:

```bash
cd $SKILL_BASE_DIR
mvn clean install -DskipTests
```

The executable JAR is at:
`$SKILL_BASE_DIR/aem65lts-migration-cli/target/aem65lts-migration-cli-1.0-SNAPSHOT.jar`

### Git

- Required for final diff and branch creation
- Verify: `git --version`

## Environment Variables

### Required

| Variable | Description | Example |
|----------|-------------|---------|
| `AEM_PROJECT_PATH` | Absolute path to the AEM project root (must contain `pom.xml`) | `/home/user/my-aem-project` |

### Optional (with defaults)

| Variable | Default | Description |
|----------|---------|-------------|
| `M2_HOME` | `~/.m2` | Maven user directory (contains `repository/`) |
| `JAVA8_HOME` | `/usr/lib/jvm/jdk-8` | JDK 8 home |
| `JAVA11_HOME` | `/usr/lib/jvm/jdk-11` | JDK 11 home |
| `JAVA21_HOME` | `/usr/lib/jvm/jdk-21` | JDK 21 home |
| `SKILL_BASE_DIR` | Directory containing this SKILL.md | Base path for recipes, configs, scripts |

## Pre-flight Checks

Before starting migration, verify:

1. `$AEM_PROJECT_PATH/pom.xml` exists
2. The project has a `.git` directory (needed for final diff)
3. All required JDKs are accessible
4. Maven can resolve dependencies (network access to Maven Central or internal repos)

---

## References

- [AEM 6.5 LTS GA release notes](https://experienceleague.adobe.com/en/docs/experience-manager-65-lts/content/release-notes/service-pack/ga)
- [Apache Maven 3.9 release notes](https://maven.apache.org/docs/3.9.0/release-notes.html)
- [Eclipse Temurin JDK 21 downloads](https://adoptium.net/temurin/releases/?version=21)
- [AEM UberJar on Maven Central](https://mvnrepository.com/artifact/com.adobe.aem/uber-jar)
