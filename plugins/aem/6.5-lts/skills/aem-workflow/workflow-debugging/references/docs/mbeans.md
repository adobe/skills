# AEM Workflow – MBeans Reference

JMX MBeans used for monitoring and operating AEM Workflow. Access via JMX console (e.g. Felix Console → JMX) or JConsole using the object names below.

---

## 1. Workflow Maintenance MBean

**ObjectName:** `com.adobe.granite.workflow:type=Maintenance`  
**Interface:** `WorkflowOperationsMBean`

Used for maintenance: purge, restart stale, terminate failed, retry failed, and read-only counts/lists.

### Operations

| Operation | Parameters | Returns | Description |
|-----------|------------|---------|-------------|
| **purgeCompleted** | `model` (optional), `numberOfDays`, `dryRun` | TabularData | Purge completed workflows older than N days. Use dryRun=true to preview. |
| **purgeActive** | `model` (optional), `numberOfDays`, `dryRun` | TabularData | Purge active (running) workflows older than N days. |
| **countStaleWorkflows** | `model` (optional) | int | Count of stale workflows (no current work item). |
| **restartStaleWorkflows** | `model` (optional), `dryRun` | TabularData | Restart stale workflow instances. |
| **fetchModelList** | — | TabularData | List of workflow models. |
| **countRunningWorkflows** | `model` (optional) | int | Count of running workflows. |
| **countCompletedWorkflows** | `model` (optional) | int | Count of completed workflows. |
| **listRunningWorkflowsPerModel** | — | TabularData | Running workflow count per model. |
| **listCompletedWorkflowsPerModel** | — | TabularData | Completed workflow count per model. |
| **returnWorkflowQueueInfo** | — | TabularData | Workflow queue information. |
| **returnWorkflowJobTopicInfo** | — | TabularData | Job topic information. |
| **returnSystemJobInfo** | — | TabularData | Overall workflow and system job queue info. |
| **returnFailedWorkflowCount** | `model` (optional) | int | Count of failed workflows. |
| **returnFailedWorkflowCountPerModel** | — | TabularData | Failed workflow count per model. |
| **terminateFailedInstances** | `restartInstance`, `dryRun`, `model` (optional) | TabularData | Terminate failed instances; optionally restart. |
| **retryFailedWorkItems** | `dryRun`, `model` (optional) | TabularData | Retry failed work items. |

---

## 2. Workflow Statistics MBean

**ObjectName:** `com.adobe.granite.workflow:type=Statistics`  
**Interface:** `WorkflowStatsMBean`

Aggregates workflow statistics from workflow events. Populated per node in a cluster.

### Attributes

| Attribute | Type | Description |
|-----------|------|-------------|
| **getResults** | TabularData | Table of workflow statistics (from events). |
| **DataLifeTime** | long | Interval (seconds) to retain data. |
| **DataFidelityTime** | long | Time granularity (seconds) for data. |
| **DataProcessRate** | long | Frequency (seconds) at which data is processed; must be ≤ DataFidelityTime. |
| **DataRate** | long | Interval (seconds) over which rates are computed. |

### Operations

| Operation | Description |
|-----------|-------------|
| **clearRecords** | Clear all records held by this MBean. |

---

## 3. Purge Scheduler (scheduled purge)

Scheduled purge is performed by **PurgeScheduler** factory configurations (OSGi), not JMX. For one-off or ad-hoc purge/restart/retry, use the **Workflow Maintenance MBean** above.

---

## Quick reference – when to use which MBean

| Goal | MBean / approach |
|------|-------------------|
| Purge completed/active workflows (one-off) | Maintenance → **purgeCompleted** / **purgeActive** |
| Count or list running/failed/completed workflows | Maintenance → **countRunningWorkflows**, **returnFailedWorkflowCount**, etc. |
| Restart stuck (stale) workflows | Maintenance → **countStaleWorkflows**, **restartStaleWorkflows** |
| Retry or terminate failed work items | Maintenance → **retryFailedWorkItems**, **terminateFailedInstances** |
| Inspect queue/topic and system job info | Maintenance → **returnWorkflowQueueInfo**, **returnWorkflowJobTopicInfo**, **returnSystemJobInfo** |
| View workflow statistics over time | Statistics → **getResults** (and tune DataLifeTime / DataFidelityTime / DataRate) |
