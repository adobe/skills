# Runbook: Model delete and update issues

**Symptom:** Cannot delete model (“running instances”); or model changes not visible after deploy.

---

## 1. Verify the issue

1. **Running instances** – JMX → `com.adobe.granite.workflow:type=Maintenance` → **countRunningWorkflows**(modelId).
2. **Paths** – Models at `/var/workflow/models` (runtime); overlay at `/conf/global/settings/workflow/models` (design-time). Cache may need time or instance restart.

---

## 2. Remediation

| Action | How |
|--------|-----|
| **Delete model** | Terminate or complete all running instances for that model, then delete the model. |
| **Model not found after deploy** | Confirm model under `/var/workflow/models` or overlay; clear cache or restart if needed. |
| **Version does not exist** | Use an existing model version or create/deploy the requested version. |

---

## 3. Delete model – steps

1. JMX → **countRunningWorkflows**(modelId). If > 0, terminate or complete those instances (e.g. via **terminateFailedInstances** or workflow UI).
2. Once no running instances use the model, delete the model from the workflow models UI or from JCR under `/var/workflow/models` (or overlay).

**Reference:** [Error patterns – model](../docs/error-patterns.md#5-version--model-errors).
