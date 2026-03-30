# Felix SCR → OSGi Declarative Services (AEM as a Cloud Service)

**Part of `aem-best-practices`.** Read this module when converting components; do not duplicate these steps inside scheduler, replication, event, or asset pattern files.

**Explicit guideline:** AEM as a Cloud Service expects **OSGi Declarative Services** with `org.osgi.service.component.annotations` (and metatype where configuration applies). **Felix SCR** (`org.apache.felix.scr.annotations`) is legacy.

## When to Use

- Any Java class still using `org.apache.felix.scr.annotations.*`
- Reviews and refactors: ensure no SCR imports remain

## Build / module notes

- Remove Felix SCR Maven plugin / `scr` processing if present; ensure **`bnd-maven-plugin`** or equivalent declares DS component metadata.
- Dependencies: `org.osgi:org.osgi.service.component.annotations` and `org.osgi:org.osgi.service.metatype.annotations` (aligned with AEM SDK / Cloud Service BOM).

## Step 1: Remove Felix SCR imports

Remove:

```java
import org.apache.felix.scr.annotations.Activate;
import org.apache.felix.scr.annotations.Component;
import org.apache.felix.scr.annotations.Deactivate;
import org.apache.felix.scr.annotations.Modified;
import org.apache.felix.scr.annotations.Properties;
import org.apache.felix.scr.annotations.Property;
import org.apache.felix.scr.annotations.Reference;
import org.apache.felix.scr.annotations.Service;
```

Add DS imports as needed:

```java
import org.osgi.service.component.annotations.Activate;
import org.osgi.service.component.annotations.Component;
import org.osgi.service.component.annotations.Deactivate;
import org.osgi.service.component.annotations.Modified;
import org.osgi.service.component.annotations.Reference;
import org.osgi.service.metatype.annotations.AttributeDefinition;
import org.osgi.service.metatype.annotations.Designate;
import org.osgi.service.metatype.annotations.ObjectClassDefinition;
```

## Step 2: Replace `@Component` and `@Service`

**Felix SCR often combined `@Component` + `@Service`.** OSGi DS uses a single `@Component` with `service = { ... }`.

```java
// BEFORE (Felix SCR)
@Component(immediate = true, metatype = true, label = "...", description = "...")
@Service(value = MyService.class)
public class MyComponent implements MyService { }

// AFTER (OSGi DS)
@Component(service = MyService.class, immediate = true)
public class MyComponent implements MyService { }
```

For multiple service interfaces:

```java
@Component(service = { Runnable.class, MyApi.class })
```

## Step 3: Replace `@Reference`

```java
// BEFORE
@Reference
private SomeService someService;

@Reference(cardinality = ReferenceCardinality.OPTIONAL)
private OptionalService optional;

// AFTER
@Reference
private SomeService someService;

@Reference(cardinality = ReferenceCardinality.OPTIONAL)
private OptionalService optional;
```

Use `org.osgi.service.component.annotations.Reference` and `ReferenceCardinality` / `ReferencePolicy` from the **OSGi** package, not Felix.

**Targeted references:**

```java
@Reference(target = "(name=my-agent)")
private DistributionAgent agent;
```

## Step 4: Replace `@Activate` / `@Deactivate` / `@Modified` signatures

Prefer **typed configuration** with `@Designate` + OCD instead of `Map<String, Object>`.

```java
// BEFORE (Felix SCR)
@Activate
protected void activate(Map<String, Object> config) {
    String x = PropertiesUtil.toString(config.get("x"), "default");
}

// AFTER (OSGi DS + metatype)
@Activate
protected void activate(MyConfig config) {
    String x = config.x();
}

@ObjectClassDefinition(name = "My Component")
public @interface MyConfig {
    @AttributeDefinition(description = "Example")
    String x() default "default";
}

@Component(service = MyService.class)
@Designate(ocd = MyComponent.MyConfig.class)
public class MyComponent implements MyService {
```

If you must keep a transition period with `Map`, use `org.osgi.service.component.annotations.Activate` with `ComponentContext` or `Map` from **`org.osgi.service.component`** — not Felix APIs.

## Step 5: Replace `@Property` / `@Properties` with metatype

Static Felix `@Property` fields become **`@ObjectClassDefinition`** + methods with `@AttributeDefinition`.

```java
// BEFORE (Felix SCR)
@Property(label = "Cron", description = "...")
public static final String CRON = "scheduler.expression";

// AFTER (OSGi DS)
@ObjectClassDefinition(name = "Scheduler Config")
public @interface Config {
    @AttributeDefinition(name = "Cron", description = "...")
    String scheduler_expression() default "0 0 2 * * ?";
}
```

Bind with `@Designate(ocd = MyComponent.Config.class)` on the component class.

For rare `property = { "key=value" }` only (no metatype), you may keep inline `property` on `@Component` — prefer OCD for user-facing config.

## Step 6: Validation checklist

- [ ] No `import org.apache.felix.scr.annotations.*` remains
- [ ] `@Component` uses `org.osgi.service.component.annotations`
- [ ] Services declared via `@Component(service = ...)` (not Felix `@Service`)
- [ ] `@Reference` / lifecycle annotations are OSGi DS packages
- [ ] Metatype uses `@ObjectClassDefinition` / `@AttributeDefinition` / `@Designate` where configuration existed
- [ ] Project still builds (`mvn clean compile`) and components start without SCR descriptor dependency

## See also

- **ResourceResolver + logging:** [resource-resolver-logging.md](resource-resolver-logging.md)
- **Pattern index:** [`../SKILL.md`](../SKILL.md)
