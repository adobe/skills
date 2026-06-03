# Build Troubleshooting Guide

This guide covers the compilation and build errors most commonly encountered when
migrating an AEM 6.5 project to Java 21. Each entry includes the exact error message
pattern, root cause, and the minimal fix required.

---

## Java 21 Compilation Errors

### 1. `source release 8 is not supported`

**Full error:**
```
[ERROR] Failed to execute goal org.apache.maven.plugins:maven-compiler-plugin:...
[ERROR] Fatal error compiling: error: Source release 8 is not supported.
[ERROR] Use --release 21 or higher.
```

**Root cause:** The `maven-compiler-plugin` is configured with `<source>8</source>` and
`<target>8</target>` (or `<source>1.8</source>`), but is being invoked with JDK 21.
JDK 21 dropped support for cross-compilation to Java 8 target via `--source 8`.

**Fix:** Update `maven-compiler-plugin` configuration to target Java 21:

```xml
<plugin>
  <groupId>org.apache.maven.plugins</groupId>
  <artifactId>maven-compiler-plugin</artifactId>
  <version>3.11.0</version>
  <configuration>
    <!-- Remove <source> and <target>, use <release> instead -->
    <release>21</release>
  </configuration>
</plugin>
```

Also update the `maven-enforcer-plugin` `requireJavaVersion` to `[21,)`.

---

### 2. `has been removed` / `deprecated and marked for removal`

**Full error examples:**
```
[ERROR] error: sun.misc.BASE64Encoder has been removed
[ERROR] error: com.sun.org.apache.xml.internal.serialize.XMLSerializer has been removed
[ERROR] warning: [removal] Integer(int) in Integer has been deprecated and marked for removal
```

**Root cause:** The code uses an internal JDK API (`sun.*`, `com.sun.*`) or a JDK class
that was deprecated for removal prior to Java 9 and removed in Java 17 or Java 21.
See [AEM deprecated and removed features](https://experienceleague.adobe.com/en/docs/experience-manager-65/content/release-notes/deprecated-removed-features) for the AEM-specific removal list.

**Common removals and replacements:**

| Removed API | Replacement |
|-------------|------------|
| `sun.misc.BASE64Encoder` | `java.util.Base64.getEncoder()` |
| `sun.misc.BASE64Decoder` | `java.util.Base64.getDecoder()` |
| `com.sun.image.codec.jpeg.*` | `javax.imageio.ImageIO` |
| `Integer(int)` constructor | `Integer.valueOf(int)` |
| `Double(double)` constructor | `Double.valueOf(double)` |
| `Long(long)` constructor | `Long.valueOf(long)` |
| `Boolean(boolean)` constructor | `Boolean.valueOf(boolean)` |
| `Character(char)` constructor | `Character.valueOf(char)` |

**Fix:** Replace with the listed API. If the removed API is in a transitive dependency
(not your own code), update the dependency to a version that has already migrated.

---

### 3. `module java.base does not export ... to unnamed module`

**Full error:**
```
[ERROR] error: package sun.reflect is not visible
[ERROR]   (package sun.reflect is declared in module java.base, which does not export it)
```

**Root cause:** The code accesses JDK-internal packages that are encapsulated since
Java 9. Under Java 21, strong encapsulation is fully enforced; the `--illegal-access`
flag that permitted this in Java 11–16 is removed.

**Fix options (in preference order):**

1. **Refactor to the public API.** This is always the correct long-term fix.
   - `sun.reflect.*` → `java.lang.reflect.*`
   - `sun.misc.Unsafe` → context-dependent; often eliminates the need with modern APIs

2. **Add `--add-opens` to the build if the access is in test code only:**

   ```xml
   <plugin>
     <groupId>org.apache.maven.plugins</groupId>
     <artifactId>maven-surefire-plugin</artifactId>
     <configuration>
       <argLine>--add-opens java.base/java.lang=ALL-UNNAMED</argLine>
     </configuration>
   </plugin>
   ```

   Never add `--add-opens` for production code paths. It is a test-only workaround.

---

### 4. `incompatible types: java.lang.Object cannot be converted to X`

**Full error:**
```
[ERROR] error: incompatible types: Object cannot be converted to String
[ERROR]   String value = map.get("key");
```

**Root cause:** Raw-type collections (`Map map` instead of `Map<String, String> map`)
produce `Object` return types. Java 21's stricter type inference (combined with
`-Xlint:unchecked` promoted to error by some enforcer configurations) flags these.

**Fix:** Parameterise the collection type:

```java
// Before
Map map = new HashMap();
String value = (String) map.get("key");

// After
Map<String, String> map = new HashMap<>();
String value = map.get("key");
```

---

### 5. `sealed`, `permits`, `record`, `yield` as Identifiers

**Full error:**
```
[ERROR] error: as of release 16, 'record' is a restricted type name and cannot be used
[ERROR] error: as of release 14, 'yield' is a restricted identifier
```

**Root cause:** These words became context-sensitive keywords in Java 14–17 and are
reserved in Java 21. Variable names, method names, or class names using these words
cause compilation failure.

**Common patterns requiring rename:**

| Identifier | Suggested Replacement |
|-----------|----------------------|
| `record` (variable) | `jcrRecord`, `dataRecord`, `entry` |
| `yield` (variable) | `yieldValue`, `returnValue`, `result` |
| `sealed` (variable) | `isSealed`, `sealedFlag` |
| `permits` (variable) | `permitsCount`, `allowedCount` |

**Fix:** Rename the identifier. If the identifier is in a public API (method name in
an interface), the interface contract must be updated and all callers updated as well.

---

## Maven Plugin Errors

### 1. `Unsupported class file major version 65`

**Full error:**
```
[ERROR] Failed to execute goal org.apache.felix:maven-bundle-plugin:...
[ERROR] Unsupported class file major version 65
```

**Root cause:** Class file major version 65 = Java 21. The `maven-bundle-plugin` version
in use embeds an old bnd library that cannot parse Java 21 class files.
See [upgrading code and customizations](https://experienceleague.adobe.com/en/docs/experience-manager-65-lts/content/implementing/deploying/upgrading/upgrading-code-and-customizations) for the minimum plugin versions required by AEM 6.5 LTS.

**Fix:** Upgrade `maven-bundle-plugin` to 5.1.9 or later:

```xml
<plugin>
  <groupId>org.apache.felix</groupId>
  <artifactId>maven-bundle-plugin</artifactId>
  <version>5.1.9</version>
  <extensions>true</extensions>
</plugin>
```

If the project uses `bnd-maven-plugin` directly, upgrade to 6.4.0+.

---

### 2. `SCRDescriptorBndPlugin not found` / `SCRDescriptor: Error processing`

**Full error:**
```
[ERROR] Failed to execute goal org.apache.felix:maven-scr-plugin:...
[ERROR] SCRDescriptorBndPlugin not found in the bnd plugins
```

**Root cause:** The `maven-scr-plugin` is incompatible with the version of bnd used by
a newer `maven-bundle-plugin`. The SCR plugin injects itself as a bnd plugin; the API
it uses has changed.

**Fix:**

*Option A* (preferred) — Remove the `maven-scr-plugin` entirely if the project uses
OSGi DS annotations (`@Component`, `@Reference` from `org.osgi.service.component.*`).
The `maven-bundle-plugin` 5.x processes DS annotations natively via bnd.

*Option B* — If the project uses Sling-specific SCR annotations, upgrade
`maven-scr-plugin` to 1.26.4:

```xml
<plugin>
  <groupId>org.apache.felix</groupId>
  <artifactId>maven-scr-plugin</artifactId>
  <version>1.26.4</version>
</plugin>
```

---

### 3. `Unable to parse class ... ClassNotFoundException: org.objectweb.asm.ClassVisitor`

**Full error:**
```
[ERROR] Unable to parse class file MyComponent.class
[ERROR] Caused by: java.lang.ClassNotFoundException: org.objectweb.asm.ClassVisitor
```

or:

```
[ERROR] ASM ClassReader failed to parse class file - probably due to a new Java class file version
```

**Root cause:** The ASM bytecode library bundled with the Maven plugin is too old to
parse Java 21 class files (ASM supports a specific maximum class file major version per
release; ASM 9.7+ is required for Java 21).

**Fix:** Upgrade the plugin to a version that ships with ASM 9.7.1. For
`maven-scr-plugin`, this is 1.26.4. For custom Mojo plugins, add an explicit ASM
dependency override:

```xml
<plugin>
  <groupId>org.apache.felix</groupId>
  <artifactId>maven-scr-plugin</artifactId>
  <version>1.26.4</version>
  <dependencies>
    <dependency>
      <groupId>org.ow2.asm</groupId>
      <artifactId>asm</artifactId>
      <version>9.7.1</version>
    </dependency>
    <dependency>
      <groupId>org.ow2.asm</groupId>
      <artifactId>asm-commons</artifactId>
      <version>9.7.1</version>
    </dependency>
  </dependencies>
</plugin>
```

---

## OSGi / Sling Runtime Errors

### 1. `Cannot resolve bundle ... com.google.common is missing`

**Full log:**
```
org.osgi.framework.BundleException: Unresolved constraint in bundle [com.example.myapp 1.0.0]:
  Unable to resolve 1.0.0: missing requirement [1.0.0] osgi.wiring.package;
  (&(osgi.wiring.package=com.google.common.collect)(version>=30.0))
```

**Root cause:** The bundle declares `Import-Package: com.google.common.collect` but
Guava is not exported by the AEM 6.5 LTS framework. The bundle cannot be resolved.
See the [Apache Sling OSGi bundle documentation](https://sling.apache.org/documentation/) for guidance on OSGi bundle resolution.

**Fix:** Apply the Guava remediation from `removed-bundles-remediation.md`:
- Refactor to JDK equivalents, or
- Embed Guava as `<Private-Package>` with `<Import-Package>!com.google.common.*,*</Import-Package>`

---

### 2. `@PostConstruct method not called` / `@Inject field is null`

**Symptom:** An OSGi component activates without error, but:
- A method annotated `@PostConstruct` is never invoked.
- A field annotated `@Inject` or `@OSGiService` remains `null` at runtime.

**Root cause:** The import statement uses the Jakarta namespace:

```java
// WRONG — compiles, but silently ignored at runtime on AEM 6.5 LTS
import jakarta.annotation.PostConstruct;
import jakarta.inject.Inject;

// CORRECT
import javax.annotation.PostConstruct;
import javax.inject.Inject;
```

**Diagnosis:** Search for jakarta imports in the codebase:

```bash
grep -r "import jakarta\." src/main/java --include="*.java"
```

**Fix:** Replace all `import jakarta.` with `import javax.` in AEM application code.
Then recheck that the `javax.*` artifacts are available on the compile classpath (they
are provided by the AEM uber-jar).

---

### 3. `Service not registered` / Component remains in `Unsatisfied` state

**Full log ([Felix web console](https://sling.apache.org/documentation/)):**
```
State: Unsatisfied Reference
  com.example.MyService -> com.example.DependencyService (0:0:0)
  [unsatisfied] required
```

**Root cause possibilities:**

1. The `@Component(service = ...)` attribute was changed during migration and no longer
   matches the interface under which the service is registered.
2. An `@Reference` targets an interface that is no longer exported (e.g., a removed AEM
   API).
3. The component property type annotation was incorrectly modified during migration,
   causing the component to fail `@Activate` with a `ComponentException`.

**Diagnosis:**

- Check Felix console at `/system/console/components` for the component's state.
- Click the component name — the "References" section lists which references are
  satisfied and which are not.
- Check `/system/console/bundles` to confirm the bundle containing the referenced
  service is `Active`.

**Fix:** Restore the original `@Component(service = ...)` value and verify that the
referenced interface is present in the AEM 6.5 LTS uber-jar APIs.

---

## Mockito / Test Framework Errors

### 1. `MockitoAnnotations.initMocks deprecated` / Test class initialisation warning

**Warning:**
```
org.mockito.exceptions.misusing.UnnecessaryStubbingException:
```
or deprecation warning about `MockitoAnnotations.initMocks(this)`.

**Root cause:** [Mockito 5.x](https://javadoc.io/doc/org.mockito/mockito-core/latest/) deprecates `MockitoAnnotations.initMocks()` in favour of
the JUnit 5 extension.

**Fix:** Replace the `@Before` setup method with the JUnit 5 `@ExtendWith` annotation:

```java
// Before (Mockito 4.x / JUnit 4 style)
@RunWith(MockitoJUnitRunner.class)
public class MyServiceTest {
    @Mock
    private ResourceResolver resolver;

    @Before
    public void setUp() {
        MockitoAnnotations.initMocks(this);
    }
}

// After (Mockito 5.x / JUnit 5 style)
@ExtendWith(MockitoExtension.class)
class MyServiceTest {
    @Mock
    private ResourceResolver resolver;
    // No @BeforeEach init needed
}
```

---

### 2. `PowerMockito is not compatible with Java 21`

**Error:**
```
java.lang.reflect.InaccessibleObjectException: Unable to make ... accessible:
  module java.base does not "opens java.lang" to unnamed module
```

or:
```
java.lang.UnsupportedOperationException: Cannot define class using reflection
```

**Root cause:** PowerMock relies on `sun.misc.Unsafe` and reflective class definition
mechanisms (`java.lang.reflect.Proxy`, `sun.reflect.ConstructorAccessor`) that are
strongly encapsulated in Java 21. PowerMock has not released a version compatible
with Java 17+.

**Fix:** Remove PowerMock and replace static method mocking with Mockito 5.x
`mockStatic()` (available in `mockito-inline`, now merged into `mockito-core`):

```java
// Before (PowerMock)
@RunWith(PowerMockRunner.class)
@PrepareForTest(StaticUtil.class)
public class MyTest {
    @Test
    public void testSomething() {
        PowerMockito.mockStatic(StaticUtil.class);
        when(StaticUtil.compute()).thenReturn("mocked");
        // ...
    }
}

// After (Mockito 5.x)
@ExtendWith(MockitoExtension.class)
class MyTest {
    @Test
    void testSomething() {
        try (MockedStatic<StaticUtil> mocked = Mockito.mockStatic(StaticUtil.class)) {
            mocked.when(StaticUtil::compute).thenReturn("mocked");
            // ... assertions
        }
    }
}
```

Update the dependency:

```xml
<!-- Remove PowerMock -->
<!-- <dependency>
  <groupId>org.powermock</groupId>
  <artifactId>powermock-module-junit4</artifactId>
</dependency> -->

<!-- Ensure Mockito 5.x is used -->
<dependency>
  <groupId>org.mockito</groupId>
  <artifactId>mockito-core</artifactId>
  <version>5.11.0</version>
  <scope>test</scope>
</dependency>
```

---

### 3. `byte-buddy version conflict` / `ClassFormatError` in Mockito

**Error:**
```
net.bytebuddy.agent.builder.AgentBuilder$Listener$StreamWriting - FAIL com.example.MyClass
java.lang.ClassFormatError: Illegal field modifiers in class com/example/MyClass
```

or:
```
java.lang.VerifyError: Bad type on operand stack
```

**Root cause:** Mockito uses Byte Buddy to generate proxy classes. An older Byte Buddy
version (below 1.14.x) cannot generate valid Java 21 class files, producing bytecode
that the JVM verifier rejects.

**Fix:** Align Byte Buddy version with Mockito. Mockito 5.x declares a compatible
Byte Buddy version as a managed dependency; the conflict arises when a parent POM or
another dependency overrides the Byte Buddy version.

Add an explicit Byte Buddy version to the `<dependencyManagement>` section:

```xml
<dependencyManagement>
  <dependencies>
    <dependency>
      <groupId>net.bytebuddy</groupId>
      <artifactId>byte-buddy</artifactId>
      <version>1.14.15</version>
    </dependency>
    <dependency>
      <groupId>net.bytebuddy</groupId>
      <artifactId>byte-buddy-agent</artifactId>
      <version>1.14.15</version>
    </dependency>
  </dependencies>
</dependencyManagement>
```

Verify with `mvn dependency:tree -Dincludes=net.bytebuddy` that no other version of
Byte Buddy is being pulled in. If there is a conflict, add an explicit `<exclusion>`
at the point where the older version is introduced.

---

## References

- [AEM 6.5 LTS GA release notes](https://experienceleague.adobe.com/en/docs/experience-manager-65-lts/content/release-notes/service-pack/ga)
- [Upgrading code and customizations](https://experienceleague.adobe.com/en/docs/experience-manager-65-lts/content/implementing/deploying/upgrading/upgrading-code-and-customizations)
- [Java deprecated and removed features](https://experienceleague.adobe.com/en/docs/experience-manager-65/content/release-notes/deprecated-removed-features)
- [Apache Sling documentation](https://sling.apache.org/documentation/)
- [Mockito Core API documentation](https://javadoc.io/doc/org.mockito/mockito-core/latest/)
