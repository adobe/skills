# AEM Workflow Debugging Guide

Reference patterns for log analysis, JCR paths, and OSGi diagnostics. Used by the **workflow-debugging** skill.

---

## Log Patterns

### 1. Launcher Activity

Enable logger: `com.day.cq.workflow.impl.launcher` at DEBUG.

**Launcher matched and workflow launched:**
```
DEBUG com.day.cq.workflow.impl.launcher.WorkflowLauncherImpl - Evaluating launcher [/conf/.../launcher/list/default/id_xyz] for event NODE_MODIFIED on /content/dam/mysite/image.jpg
DEBUG com.day.cq.workflow.impl.launcher.WorkflowLauncherImpl - Launching workflow [/conf/.../workflow/models/dam-update] for path [/content/dam/mysite/image.jpg]
```

**Launcher evaluated but did not match:**
```
DEBUG com.day.cq.workflow.impl.launcher.WorkflowLauncherImpl - Evaluating launcher [id_xyz] — condition not met: glob pattern /content/dam/.* does not match /content/mysite/page
```

**If no "Evaluating launcher" lines appear for the event:** The JCR observation event is not reaching the launcher. Check if the session that made the change has observation registration bypassed, or if the change is happening on publish (launchers run on author).

**Launcher disabled:**
```
DEBUG ...WorkflowLauncherImpl - Launcher [id_xyz] is disabled, skipping
```

---

### 2. Step Execution

Enable logger: `com.day.cq.workflow` and your custom class package at DEBUG.

**Step starting:**
```
DEBUG com.adobe.granite.workflow.core.job.HandlerBase - Executing step 'My Custom Step' for workItem [<id>] with payload [/content/dam/mysite/image.jpg]
```

**Step completing normally:**
```
DEBUG com.adobe.granite.workflow.core.job.HandlerBase - WorkItem [<id>] completed step 'My Custom Step'
```

**WorkflowException thrown:**
```
ERROR com.adobe.granite.workflow.core.job.HandlerBase - WorkflowException in step 'My Custom Step': <message>
com.adobe.granite.workflow.exec.WorkflowException: <message>
    at com.myproject.core.workflow.MyWorkflowProcess.execute(MyWorkflowProcess.java:45)
```

**Step not calling complete() — no explicit error, step just hangs:**
- No "completed step" line appears after "Executing step"
- The workItem node persists at `/var/workflow/instances/<date>/<id>/workItems/`
- Search logs for the step label — if only "Executing" appears and nothing after it, `complete()` was never called

---

### 3. Service User / Access Control

Enable logger: `org.apache.jackrabbit.oak.spi.security` at DEBUG (verbose, use briefly).

**AccessDeniedException:**
```
javax.jcr.AccessDeniedException: OakAccess0000: Access denied [path=/content/dam/mysite, privilege=jcr:write]
```

**Service resolver not available (mapping missing):**
```
ERROR com.myproject.core.workflow.MyWorkflowProcess - Cannot get service resolver for subServiceName 'my-workflow-service'
org.apache.sling.api.resource.LoginException: Cannot derive user name for bundle com.myproject.core and subServiceName my-workflow-service
```

**Fix path:** Add the service user mapping in OSGi config. Verify the mapping is listed at:
Felix Console > Sling > Service User Mapper

---

### 4. OSGi Service Not Available

**WorkflowProcess not registered (often due to bundle not active):**
```
ERROR com.adobe.granite.workflow.core - No WorkflowProcess found for process label 'My Custom Step'
```

**Bundle inactive:**
```
WARN org.apache.felix.scr - Component [com.myproject.core.workflow.MyWorkflowProcess] not satisfied — missing reference 'myService' [com.myproject.core.service.MyService]
```

**How to check:**
- Felix Console > Bundles: find your bundle, status must be `Active` (not `Installed` or `Resolved`)
- Felix Console > Components: find your `WorkflowProcess` class, status must be `satisfied`

**Common causes:**
- A `@Reference` pointing to a service that is itself unsatisfied or not deployed
- Missing `Import-Package` in `bnd.bnd` for a new dependency

---

### 5. Workflow Model Sync Issues

**Symptom in logs:**
```
WARN com.adobe.granite.workflow - Workflow model /conf/.../models/mymodel not found in runtime location /var/workflow/models/mymodel
```

**Or silently**: model changes in `/conf/` are not reflected at runtime without a Sync.

**Manual check:** Compare node count under:
- `/conf/<tenant>/settings/workflow/models/<model>/jcr:content/flow/` (editable)
- `/var/workflow/models/<model>/jcr:content/flow/` (runtime)

Using CRXDE or curl:
```bash
# List step nodes in editable model
curl -u admin:admin "http://localhost:4502/conf/<tenant>/settings/workflow/models/<model>.infinity.json" | jq '.["jcr:content"].flow | keys'

# List step nodes in runtime model
curl -u admin:admin "http://localhost:4502/var/workflow/models/<model>.infinity.json" | jq '.["jcr:content"].flow | keys'
```

---

## JCR Structure Reference

### Workflow Instance Nodes

```
/var/workflow/instances/
  └── server0/
      └── 2024-01-15/
          └── <instance-id>/
              ├── jcr:primaryType = "cq:Workflow"
              ├── state = "RUNNING" | "COMPLETED" | "ABORTED" | "STALE"
              ├── model = "/var/workflow/models/<model>/jcr:content"
              ├── startTime
              ├── endTime (if completed)
              ├── data/
              │   ├── payload = "/content/dam/mysite/image.jpg"
              │   ├── payloadType = "JCR_PATH"
              │   └── metaData/
              │       ├── workflowTitle = "..."
              │       └── <custom variables set by steps>
              ├── workItems/
              │   └── <work-item-id>/           ← exists only while step is active
              │       ├── jcr:primaryType = "cq:WorkItem"
              │       ├── node = "/var/workflow/models/<model>/jcr:content/flow/<step-node>"
              │       ├── startTime
              │       └── metaData/
              └── history/
                  ├── <step-1-id>/
                  │   ├── node = "/var/workflow/models/.../flow/<step-node>"
                  │   ├── startTime
                  │   ├── endTime
                  │   └── comment
                  └── <step-2-id>/
                      └── ...
```

### Workflow Model Nodes

```
/var/workflow/models/<model>/
  └── jcr:content/
      ├── title = "My Workflow"
      └── flow/
          ├── <step-node-1>/         ← execution order by node name (usually flow1, flow2...)
          │   ├── type = "cq/workflow/components/process"
          │   ├── title = "My Step"
          │   └── metaData/
          │       ├── PROCESS = "My Custom Step"  ← must match process.label
          │       └── PROCESS_ARGS = "key1=val1\nkey2=val2"
          ├── <step-node-2>/
          │   ├── type = "cq/workflow/components/participant"
          │   └── metaData/
          │       └── PARTICIPANT = "workflow-administrators"
          └── <or-split>/
              ├── type = "cq/workflow/components/or-split"
              └── branches/
                  ├── branch1/
                  │   └── ROUTE_CONDITION = "${payload.properties['jcr:primaryType'] == 'dam:Asset'}"
                  └── branch2/
```

---

## Diagnostic URLs (AEM 6.5)

| Purpose | URL |
|---------|-----|
| Felix console | `http://localhost:4502/system/console` |
| Bundle list | `http://localhost:4502/system/console/bundles` |
| Component list | `http://localhost:4502/system/console/components` |
| Service list | `http://localhost:4502/system/console/services?objectClass=com.adobe.granite.workflow.exec.WorkflowProcess` |
| Service user mapper | `http://localhost:4502/system/console/serviceusers` |
| Log support | `http://localhost:4502/system/console/slinglog` |
| JMX WorkflowMaintenance | `http://localhost:4502/system/console/jmx/com.adobe.granite.workflow%3Atype%3DMaintenance` |
| Workflow instances (JSON) | `http://localhost:4502/var/workflow/instances.infinity.json` |
| Specific instance (JSON) | `http://localhost:4502/var/workflow/instances/<date>/<id>.infinity.json` |

---

## AEM as a Cloud Service Differences

| Topic | 6.5 | Cloud Service |
|-------|-----|---------------|
| JMX console | Available at Felix console | Not directly accessible; use Developer Console |
| Log access | `error.log` on server | Cloud Manager log download or log tailing in Developer Console |
| CRXDE | Always available | Available in Dev/Stage; disable in Prod by default |
| Groovy console | Via community package | Not available in production |
| Service user mapping | OSGi config in `ui.config` | Same; deployed via Cloud Manager pipeline |
| Outbound HTTP | Open by default | Requires Advanced Networking / egress config |
| Workflow engine config | Tunable OSGi PIDs | Partially managed by Adobe; core engine PIDs should not be changed |

---

## Step-by-Step: Reproducing a WorkflowProcess Bug Locally

1. Add test dependency to `core/pom.xml` (if not present):
```xml
<dependency>
  <groupId>io.wcm.testing</groupId>
  <artifactId>io.wcm.testing.aem-mock.junit5</artifactId>
  <scope>test</scope>
</dependency>
```

2. Create a JUnit 5 test:
```java
@ExtendWith(AemContextExtension.class)
class MyWorkflowProcessTest {

    private final AemContext context = new AemContext();

    @Test
    void testExecute_success() throws WorkflowException {
        // Arrange
        MyWorkflowProcess step = new MyWorkflowProcess();
        // inject @Reference fields via reflection or context.registerService()
        context.registerService(MyService.class, mock(MyService.class));
        context.registerInjectActivateService(step);

        WorkItem workItem = mock(WorkItem.class);
        WorkflowData wfData = mock(WorkflowData.class);
        when(workItem.getWorkflowData()).thenReturn(wfData);
        when(wfData.getPayload()).thenReturn("/content/dam/mysite/image.jpg");

        WorkflowSession wfSession = mock(WorkflowSession.class);
        MetaDataMap args = new SimpleMetaDataMap();
        args.put("MY_ARG", "test-value");

        // Act
        step.execute(workItem, wfSession, args);

        // Assert
        verify(wfSession).complete(eq(workItem), any());
    }
}
```

3. Run: `mvn test -pl core -Dtest=MyWorkflowProcessTest`

---

## Common Fixes at a Glance

| Symptom | Root cause | Fix |
|---------|------------|-----|
| Step hangs, no error | `complete()` not called | Add `workflowSession.complete(workItem, null)` on all success paths |
| Step hangs silently | Exception swallowed | Replace `log.error(e)` + return with `throw new WorkflowException(e)` |
| `AccessDeniedException` | Service user missing ACL | Add ACL for service user on target path in `ui.config` |
| `LoginException` on service resolver | Service user mapping missing | Add `ServiceUserMapperImpl.amended` config with bundle + subService mapping |
| `No WorkflowProcess for label X` | Bundle inactive or component unsatisfied | Check Felix Bundles; fix unsatisfied `@Reference` |
| Step fails with `NullPointerException` on args | Process argument key mismatch | Align key name between step dialog and `args.get("KEY", ...)` |
| Launcher not firing | Glob doesn't match path | Fix glob; test against actual payload path |
| Launcher not firing | Model not synced | Sync model in Models console |
| History COMPLETED, status RUNNING | Model-runtime mismatch | Sync model; terminate stale instance |
| Many instances building up | No purge config | Add `com.adobe.granite.workflow.purge.Scheduler` config |
