/*
 * StaleWorkflowServlet — Cloud Service replacement for the JMX
 * `com.adobe.granite.workflow:type=Maintenance` restartStaleWorkflows /
 * countStaleWorkflows operations, which are not reachable on AEMaaCS.
 *
 * Deploy in your customer codebase (e.g. core/src/main/java/...), expose
 * only to author instances, and protect with ACLs so only administrators
 * can invoke it. Always call with dryRun=true first.
 *
 * IMPORTANT — caller must be a workflow superuser.
 * Internally the servlet adapts the request's ResourceResolver to a
 * WorkflowSession. Granite Workflow's WorkflowSessionImpl short-circuits
 * non-superuser callers to getUsersWorkflowInstances(userId, ...), which
 * returns only workflows the caller personally initiated — so a non-superuser
 * would see an empty or partial stale list and silently misdiagnose the
 * system as healthy. The servlet enforces this with a 403 check up front;
 * add the caller to the group named by the `cq.workflow.superuser` property
 * on `com.adobe.granite.workflow.core.WorkflowSessionFactory` before invoking.
 *
 * GET  /bin/support/workflow/stale?dryRun=true[&model=<modelId>]
 *   → JSON report of stale instances (count + IDs), no writes.
 * POST /bin/support/workflow/stale?dryRun=false[&model=<modelId>]
 *   → Restarts each stale instance. Returns counts.
 *
 * A workflow is considered stale when:
 *   - state == RUNNING
 *   - AND it has no active work item (getWorkItems() empty)
 *
 * This mirrors Granite Workflow's own definition used by restartStaleWorkflows.
 */
package com.example.aem.support.workflow;

import com.adobe.granite.workflow.WorkflowException;
import com.adobe.granite.workflow.WorkflowSession;
import com.adobe.granite.workflow.exec.Workflow;
import com.google.gson.JsonArray;
import com.google.gson.JsonObject;
import org.apache.sling.api.SlingHttpServletRequest;
import org.apache.sling.api.SlingHttpServletResponse;
import org.apache.sling.api.resource.ResourceResolver;
import org.apache.sling.api.servlets.SlingAllMethodsServlet;
import org.osgi.service.component.annotations.Component;

import javax.servlet.Servlet;
import javax.servlet.http.HttpServletResponse;
import java.io.IOException;
import java.util.List;

@Component(
    service = Servlet.class,
    property = {
        "sling.servlet.paths=/bin/support/workflow/stale",
        "sling.servlet.methods=GET",
        "sling.servlet.methods=POST"
    }
)
public class StaleWorkflowServlet extends SlingAllMethodsServlet {

    @Override
    protected void doGet(SlingHttpServletRequest req, SlingHttpServletResponse resp)
        throws IOException {
        handle(req, resp, /* forceDryRun */ true);
    }

    @Override
    protected void doPost(SlingHttpServletRequest req, SlingHttpServletResponse resp)
        throws IOException {
        handle(req, resp, /* forceDryRun */ false);
    }

    private void handle(SlingHttpServletRequest req, SlingHttpServletResponse resp,
                        boolean forceDryRun) throws IOException {
        boolean dryRun = forceDryRun || !"false".equals(req.getParameter("dryRun"));
        String model = req.getParameter("model"); // optional

        ResourceResolver resolver = req.getResourceResolver();
        WorkflowSession wfSession = resolver.adaptTo(WorkflowSession.class);

        JsonObject out = new JsonObject();

        // P0 guard: non-superuser callers would silently get only their own
        // initiated workflows (see WorkflowSessionImpl.getWorkflows branch).
        // Reject up front rather than return misleading data.
        if (wfSession == null || !wfSession.isSuperuser()) {
            resp.setStatus(HttpServletResponse.SC_FORBIDDEN);
            resp.setContentType("application/json");
            resp.setCharacterEncoding("UTF-8");
            out.addProperty("error",
                "Caller is not a workflow superuser. Add the caller to the group named "
                + "by cq.workflow.superuser on com.adobe.granite.workflow.core.WorkflowSessionFactory, "
                + "then retry. Running without superuser would return only workflows the caller "
                + "initiated and mask stale instances owned by others.");
            resp.getWriter().write(out.toString());
            return;
        }

        JsonArray stale = new JsonArray();
        int restarted = 0;
        int errors = 0;

        try {
            // Push the state filter into the JCR query rather than loading
            // every workflow (RUNNING + COMPLETED + ABORTED + ...) into memory
            // and filtering in Java. On systems that haven't purged recently
            // the former would OOM or take multiple seconds per call.
            List<Workflow> running =
                wfSession.getWorkflows(new String[]{"RUNNING"}, 0, -1).getItems();
            for (Workflow wf : running) {
                if (model != null && !model.equals(wf.getWorkflowModel().getId())) continue;
                if (!wf.getWorkItems().isEmpty()) continue; // has live work item → not stale

                JsonObject entry = new JsonObject();
                entry.addProperty("id", wf.getId());
                entry.addProperty("model", wf.getWorkflowModel().getId());
                entry.addProperty("payload", wf.getWorkflowData().getPayload().toString());
                stale.add(entry);

                if (!dryRun) {
                    try {
                        wfSession.restartWorkflow(wf);
                        restarted++;
                    } catch (WorkflowException e) {
                        errors++;
                        entry.addProperty("restartError", e.getMessage());
                    }
                }
            }
            out.addProperty("dryRun", dryRun);
            out.addProperty("staleCount", stale.size());
            out.addProperty("restarted", restarted);
            out.addProperty("errors", errors);
            out.add("instances", stale);
        } catch (WorkflowException e) {
            resp.setStatus(500);
            out.addProperty("error", e.getMessage());
        }

        resp.setContentType("application/json");
        resp.setCharacterEncoding("UTF-8");
        resp.getWriter().write(out.toString());
    }
}
