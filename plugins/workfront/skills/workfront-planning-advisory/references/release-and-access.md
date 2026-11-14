# Release, licensing, access, and surface guide

Last reviewed: October 8, 2026. Scope: Q4 release notes updated October 6, plus Q1 to Q3 changes. These are public-document checks, not tenant verification. A fast release date does not mean universal availability; consult the availability ledger and check tenant provisioning.

## Three licensing cases, not one bundled assumption

| Customer model | Planning user licenses | Relationship to Workflow |
|---|---|---|
| Equal bundled quantities | Standard, Contributor, None | Planning Standard requires a paid Workflow license, including Workflow Standard or Light, not Workflow Contributor |
| Unequal quantities | Standard or None; no Planning Contributor | Workflow and Planning licenses can be freely combined |
| Standalone, for new customers | Administrator (assigned through Admin Console) or Standard, available with all Planning packages | No Workflow subscription/features required or implied |

Planning Select/Prime/Ultimate packages, Planning user licenses, and Workfront Workflow packages/licenses are different dimensions. Only the two published record-volume limits vary numerically by Planning package; feature eligibility is a separate check. Template bundles require Workflow Prime/Ultimate. Connecting record types from different workspaces requires Planning Prime/Ultimate, whether Planning is bundled with Workflow or standalone; same-workspace connections work with any Planning package ([connection access requirements](https://experienceleague.adobe.com/en/docs/workfront/using/adobe-workfront-planning/adobe-workfront-planning-architecture/manage-dependent-connections)).

In the Access Level box, the former License Type field is now **Workflow License Type** (label only), and customers with a Planning package see a separate **Planning License Type** field. Point admins to these field names when assigning Planning licenses.

Standalone supports users and teams for sharing, not Workflow groups, roles, or companies. It does not support Workfront object connections or automations that create Workfront objects. Do not recommend those bridges, Workflow admin features, or legacy Workflow reports as standalone capabilities.

Sources: [license overview](https://experienceleague.adobe.com/en/docs/workfront/using/adobe-workfront-planning/adobe-workfront-planning-access/license-type-overview), [standalone overview](https://experienceleague.adobe.com/en/docs/workfront/using/adobe-workfront-planning/planning-standalone/planning-sta-overview), [standalone access](https://experienceleague.adobe.com/en/docs/workfront/using/adobe-workfront-planning/planning-standalone/access-needed-for-planning-sta), and Q3 notes (July 16 licensing change). Do not reuse older Contributor text without checking which licensing case it describes.

## Permissions: distinguish viewing, editing, and defaults

- Open/Restricted default record permissions control **editing of newly created records**, across creation paths; they do not change existing records or make Restricted records invisible. Others retain View. System administrators and workspace managers retain Manage. Under Restricted, the record creator is always an editor and cannot be removed; extra editors must already have Contribute or Manage on the record type. Only Planning Standard users can hold Manage on records; other licenses get View only.
- Record overrides use View/Manage and cannot exceed record-type permissions. In the documented model, removing an individual's record grant does not remove their inherited View. Do not sell these as per-record confidentiality or individual no-view denial.
- Workspace, record type, record, field, view, and request permissions are separate surfaces. A hidden view column is not field security.
- Field sharing sets No Access, View field values, or Manage field values per field. Restrictions apply in views, record details, connections and lookups, Canvas dashboards, the API, MCP tools, exports, and imports. They do **not** apply to request forms (fields on a form are open to anyone submitting it, regardless of field sharing) or public views (fully visible, read-only). The Q4 "Sharing fields in Workfront Planning" release note lists request forms among enforced surfaces, but the [share fields](https://experienceleague.adobe.com/en/docs/workfront/using/adobe-workfront-planning/adobe-workfront-planning-access/share-fields) statement went live later (October 1) and is the one to follow; keep fields submitters must not see off the form. Formula fields show calculated values unless the formula field is restricted too. System, primary, and lookup fields cannot be shared. Field access can be lowered only for people with View on the record type; Contribute or higher cannot be lowered, and workspace managers always keep Manage. Treat field sharing as one control for sensitive data, not a complete one, and check rollout (see ledger).
- Request permissions are View, Contribute, and Manage; configure requester defaults rather than assuming every requester can edit.
- Workspace ownership transfers only to a Planning Standard user; the former owner retains Manage.
- Non-admin workspace managers can make a record type connectable from specific workspaces. All-workspace connectability and system-wide workspace sharing require a system administrator.
- Public sharing of a global record type's views is available only from its original workspace, not a secondary workspace.

Sources: [default records](https://experienceleague.adobe.com/en/docs/workfront/using/adobe-workfront-planning/adobe-workfront-planning-access/set-default-record-permissions), [share fields](https://experienceleague.adobe.com/en/docs/workfront/using/adobe-workfront-planning/adobe-workfront-planning-access/share-fields), [sharing overview](https://experienceleague.adobe.com/en/docs/workfront/using/adobe-workfront-planning/adobe-workfront-planning-access/sharing-permissions-overview), [view sharing](https://experienceleague.adobe.com/en/docs/workfront/using/adobe-workfront-planning/adobe-workfront-planning-access/share-views), and Q2 to Q4 notes.

## AI and approval choices

**CX Enterprise Coworker** replaces AI Assistant through a phased rollout. It is read-only by default; administrators enable write actions. Sensitive-industry exclusions retain AI Assistant. Consult the availability ledger for rollout dates and check which surface is provisioned in the tenant before recommending writes.

**Planning Designer (Beta)** is the separate workspace-generation surface, available to all Planning customers since July 16. Since July 20 it requires acceptance of the Beta agreement, not the separate AI agreement. Administrators control it in Setup > System > Preferences > AI Preferences: **Opt in to AI Betas**, then the **Planning Designer** toggle (both on by default; the Beta agreement must still be accepted). Do not label it "AI Designer" or conflate its access with Workflow Plan licenses.

AI Form Fill can pull field data from a Planning record when the record's direct URL is pasted into the prompt, and uses it to suggest form values. This is not connected-record traversal or unrestricted browsing; validate the inputs it actually receives.

Request forms support single-stage and sequential multi-stage approvals, including reusable approval templates. All required approvers must complete a stage unless its "Only one decision required" rule applies; a team participant requires one team member's decision. First matching field-value routing rule wins, with default routing as fallback. Rejection prevents record creation.

Submitted requests can be edited **before record creation**; this is not evidence of a revise/resubmit approval loop. Do not promise such loops.

Form display logic can use any Planning field, including connection fields, so forms adapt to what requesters select. Field options (for example, select choices, order, and default) can be edited directly from the form builder. Editing or deleting a record field warns about the request forms that use it.

For global record types, a secondary-workspace form routes to that secondary workspace, while the original form and main Requests-area route go to the original workspace. A populated Workspace field can override that default. Original Request connections expose submission/approval metadata; Approved date/by moved out of the UI field catalog into Original Request lookups, not necessarily out of backend enums.

Sources: Q2 to Q4 notes and [request approvals](https://experienceleague.adobe.com/en/docs/workfront/using/adobe-workfront-planning/adobe-workfront-planning-requests/add-approval-to-request-form).

## Business rules

Workspace managers configure conditional edit/delete restrictions as formula `IF` expressions, not general workflow engines. Business rules are unavailable on global record types in their primary or secondary workspaces. Conditions cannot reference Formula, Lookup, or Reference fields. Connected fields can be used with array checks, for example `ARRAYLENGTH(field)=0` instead of `ISBLANK`. Rules apply to everyone who can edit or delete records.

Rules do not block record creation and never edit or delete records themselves. A new or edited rule does not change existing records; it applies to them at the next edit or delete.

Source: [configure business rules](https://experienceleague.adobe.com/en/docs/workfront/using/adobe-workfront-planning/adobe-workfront-planning-architecture/configure-business-rules).

## Connections, fields, and display

- Dependent connections require an existing relation between the source and dependent types, with both connection fields on the same third (host) type; a chain stays on that host. At most 3 controllers per dependent field, 6 dependency connections and 7 types in the dependency structure. Changing a source clears dependent values. Turning on **Make this connection dependent** automatically turns on **Create a corresponding field on linked record type**, and that field counts toward the 500-fields-per-record-type limit. Cross-workspace supported; Workfront/AEM connections excluded. This is different from picker filters and hierarchies.
- New duplicate handling for one-to-one/one-to-many connections keeps the connection on the original record by default; the alternative moves it to the duplicate. Earlier production behavior differs, so check rollout.
- New select choices use friendly stored values; existing IDs stay unchanged and choice renames preserve the stored value. Existing types above 30 connection fields keep them but cannot add more (Q1).
- Default values are available for select and People fields. Date fields can show a fixed timezone to all collaborators. Lookups include Workfront reference/People fields and Planning People fields.
- Timeline supports swimlanes, breakdown filters, sorting, group collapse, a grouping panel that is resizable in the Swimlane layout only (full group-name tooltips work in Swimlane and Stacked), and custom weeks where available. Only one breakdown at a time remains. Custom weeks are configured with custom quarters in Setup > Custom Quarters, for both Workflow-plus-Planning and standalone Planning customers. They display only in Planning timeline views, not in Workfront reports or lists.
- Calendar week view initially displays 1,000 records **across the visible week**, with Load more. This is display paging, not a record storage cap.
- Table column aggregation now covers non-number fields: text, select, checkbox, and people fields get EMPTY/NOT EMPTY; date fields get MAX/MIN; formula fields follow their format. NONE is the default for all field types. Created by, Last modified by, and Record ID are excluded.
- Canvas table/KPI/chart reports support currency fields. Data Connect can provide entitled Planning data in Snowflake secure views; it is not native legacy-report support.
- AEM Content Fragment lookups include audit metadata. AEM metadata synchronization requires Planning, GenStudio for Performance Marketing, and AEM, and covers only GenStudio workspace record types (Campaign, Product, Persona, Region, Channel), not Planning record types in general. Content Fragment sync is campaign-centric, with the other four shown read-only. GenStudio Brands on request forms require GenStudio.

Sources: [dependent connections](https://experienceleague.adobe.com/en/docs/workfront/using/adobe-workfront-planning/adobe-workfront-planning-architecture/manage-dependent-connections), [connections overview](https://experienceleague.adobe.com/en/docs/workfront/using/adobe-workfront-planning/adobe-workfront-planning-architecture/connect-record-types-overview), [create fields](https://experienceleague.adobe.com/en/docs/workfront/using/adobe-workfront-planning/adobe-workfront-planning-fields/create-fields), [custom quarters and weeks](https://experienceleague.adobe.com/en/docs/workfront/using/administration-and-setup/set-up-wf/configure-system-defaults/enable-custom-quarters-projects), and release notes below.

## Availability ledger

Dates are Preview / production fast / production everyone unless noted. "Everyone" is a scheduled date, not a verified tenant state.

| Feature | Dates in 2026 |
|---|---|
| v2 direct API; AEM metadata sync | May 28 for everyone |
| Workfront reference lookups; timeline breakdown filters; submitted-request editing; field-change form warnings | May 27 / June 11 / July 16 |
| Select/People defaults | June 18 / July 15 / July 16 |
| Fixed timezone; numeric table aggregation | June 11 / July 15 / July 16 |
| Currency Canvas reports | June 25 / July 15 / July 16 |
| Open/Restricted editing defaults; timeline swimlanes | July 7 / July 15 / July 16 |
| Record View/Manage overrides | May 28 / June 11 / July 16 |
| Template bundles | April 2 / April 15 / April 16, Workflow Prime/Ultimate |
| Licensing changes; Data Connect Planning data | July 16 for everyone, Data Connect entitlement required |
| Planning Designer Beta | May 28 / June 11 / July 16; Beta agreement requirement July 20 for everyone |
| Dependent connections | July 30 / August 13 / October 15 |
| Global request routing | August 13 / September 17 / October 15 |
| Calendar 1,000/Load more; collapse groups; resize timeline grouping panel | August 27 / September 17 / October 15 |
| Coworker | September 3 / September 17 / everyone rollout begins October 15 |
| Business rules; picker filters; custom weeks | September 3 / September 17 / October 15 |
| Duplicate connection choice | September 17 / October 14 / October 15 |
| Field sharing; request sharing/defaults; multi-stage approvals | September 25 / October 14 / October 15 |
| Filter UI labels; non-numeric aggregation; owner transfer; timeline sorting | October 1 / October 14 / October 15 |
| AI Form Fill from pasted Planning record URLs | September 22 for everyone |
| AEM Content Fragment lookups | May 14 for everyone |
| GenStudio Brands on request forms | June 5 for everyone |
| Custom record Details views | May 14 / June 11 / July 16 |
| Streamlined global record type addition | May 28 / June 11 / July 16 |
| Sample workspaces tab | June 1 / June 11 / July 16 |
| Workflow/Planning License Type fields | July 16 for everyone |
| Custom record colors; connection-based color-coding | July 23 / August 13 / October 15 |
| Request-form connection display logic; edit field options from form | September 25 / October 14 / October 15 |

Canonical release sources: [Q1](https://experienceleague.adobe.com/en/docs/workfront/using/product-announcements/product-releases/planning-release-activity/planning-release-activity-26-q1), [Q2](https://experienceleague.adobe.com/en/docs/workfront/using/product-announcements/product-releases/planning-release-activity/planning-release-activity-26-q2), [Q3](https://experienceleague.adobe.com/en/docs/workfront/using/product-announcements/product-releases/planning-release-activity/planning-release-activity-26-q3), [Q4](https://experienceleague.adobe.com/en/docs/workfront/using/product-announcements/product-releases/planning-release-activity/planning-release-activity-26-q4).
