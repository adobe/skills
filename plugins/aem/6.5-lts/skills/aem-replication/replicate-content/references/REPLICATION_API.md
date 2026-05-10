# Replication API — Detailed Reference

Programmatic replication via the AEM Java API or HTTP endpoint.

## Java API

### Basic Usage

```java
import com.day.cq.replication.Replicator;
import com.day.cq.replication.ReplicationActionType;
import com.day.cq.replication.ReplicationException;
import javax.jcr.Session;
import org.apache.sling.api.resource.ResourceResolver;

@Reference
private Replicator replicator;

public void activate(ResourceResolver resolver, String path) throws ReplicationException {
    replicator.replicate(resolver.adaptTo(Session.class), ReplicationActionType.ACTIVATE, path);
}

public void deactivate(ResourceResolver resolver, String path) throws ReplicationException {
    replicator.replicate(resolver.adaptTo(Session.class), ReplicationActionType.DEACTIVATE, path);
}
```

### ReplicationActionType Values

| Type | Effect |
|------|--------|
| `ACTIVATE` | Publish to Publish instances |
| `DEACTIVATE` | Remove from Publish instances |
| `DELETE` | Permanently delete from Publish |
| `TEST` | Test agent connectivity only |
| `REVERSE` | Reverse replicate (Publish → Author) |

### ReplicationOptions

```java
import com.day.cq.replication.ReplicationOptions;
import com.day.cq.replication.AgentFilter;

ReplicationOptions opts = new ReplicationOptions();
opts.setSynchronous(true);           // wait for completion before returning
opts.setSuppressVersions(true);      // skip version creation
opts.setFilter(agent -> agent.getId().equals("publish")); // target specific agent

replicator.replicate(session, ReplicationActionType.ACTIVATE, path, opts);
```

## HTTP / curl

### Activate a page

```bash
curl -s -u "$AEM_USER:$AEM_PASSWORD" -X POST \
  http://localhost:4502/bin/replicate.json \
  -F "cmd=Activate" \
  -F "path=/content/mysite/en/page"
# ✓ Verify: HTTP 200, response body {"success":true,"path":"/content/mysite/en/page"}
```

### Deactivate a page

```bash
curl -s -u "$AEM_USER:$AEM_PASSWORD" -X POST \
  http://localhost:4502/bin/replicate.json \
  -F "cmd=Deactivate" \
  -F "path=/content/mysite/en/page"
# ✓ Verify: HTTP 200, response body {"success":true}
```

### Tree activation via HTTP

```bash
curl -s -u "$AEM_USER:$AEM_PASSWORD" -X POST \
  http://localhost:4502/etc/replication/treeactivation.html \
  -F "path=/content/mysite/en" \
  -F "onlyModified=true"
# Note: returns HTML — check for "successfully" in response body
# ✓ Verify: HTTP 200 and no error text in response
```

### With HTTP status check (production scripts)

```bash
response=$(curl -s -w "\n%{http_code}" -u "$AEM_USER:$AEM_PASSWORD" -X POST \
  http://localhost:4502/bin/replicate.json \
  -F "cmd=Activate" -F "path=/content/mysite/en/page")
http_code=$(echo "$response" | tail -n1)
body=$(echo "$response" | sed '$d')
[ "$http_code" -eq 200 ] || { echo "Failed: HTTP $http_code — $body"; exit 1; }
echo "$body" | grep -q '"success":true' || { echo "Replication error: $body"; exit 1; }
```

## Service User Setup

Use a dedicated service user (not `admin`) in OSGi components. Create an OSGi config file:

```json
// org.apache.sling.serviceusermapping.impl.ServiceUserMapperImpl.amended-replication.cfg.json
{
  "user.mapping": [
    "com.example.bundle:replication-service=replication-service-user"
  ]
}
```

Grant the service user `jcr:read` on the content path and `crx:replicate` privilege.

For a complete API reference (ReplicationStatus, AgentManager, ReplicationQueue, ReplicationListener), see the `replication-api` skill.
