# Workfront Planning notifications

Sources:
- https://experienceleague.adobe.com/en/docs/workfront/using/adobe-workfront-planning/adobe-workfront-planning-notifications/manage-notification-preferences (April 1 2026)
- https://experienceleague.adobe.com/en/docs/workfront/using/adobe-workfront-planning/adobe-workfront-planning-notifications/manage-planning-email-notifications (April 1 2026)
- https://experienceleague.adobe.com/en/docs/workfront/using/adobe-workfront-planning/adobe-workfront-planning-notifications/manage-planning-in-app-notifications (March 15 2026)

## Critical distinction
- **Workfront Planning notifications are managed in the ADOBE PREFERENCES area, NOT the Workfront Notifications area on your user profile.**
- Requires Adobe Experience Cloud login + Unified Experience onboarding for the org.

## Events that trigger WFP notifications

### Always trigger (when settings enabled)
1. Someone tags you (or your team) in a comment on a record
2. Someone requests permission to access a view, workspace, or record type
3. Someone grants you permission to a view, workspace, or record type
4. You submit a WFP request (confirmation)
5. Someone approves/rejects a WFP request you submitted
6. Status changes on a WFP request you submitted

## Where to manage WFP notifications

### Path
- Adobe Experience Cloud → Preferences area → Notifications section → click **Workfront**
- Toggle on/off:
  - **Approvals** — submitted Planning requests for approval; access requests
  - **Mentions** — tags in WFP comments
  - **Requests** — permission grants and request notifications

## Email notifications

### Sender
- "Adobe Workfront" (from Adobe Experience Cloud — note: emails for permission requests come from Adobe Experience Cloud, not Workfront)

### Triggers
- Tagged in a record comment
- Permission request for view/workspace/record type
- Permission grant confirmation
- Request submitted (confirmation)
- Request approved/rejected
- Status change on a submitted request

### Approval action from email
- Click "Open request" → opens request in WFP
- "Review and approve" button → Approve (creates record) or Reject (no record; request status = Rejected, kept in Requests area)

### "View all notifications" link
- Opens unified Notifications page in Adobe Experience Cloud
- Shows notifications from all Adobe Experience Cloud applications

## In-app notifications

### Triggers (subset of email)
- Tagged in a record comment
- Permission request for view/workspace
- Permission grant for view/workspace

### Access
- Click in-app Notifications icon (bell)
- Click a notification → opens the record details page or relevant object

## SA notes
- The split-system pattern (Adobe Preferences for WFP, Workfront Notifications for Workfront) is a common confusion point. New users repeatedly look in the wrong place.
- Email senders differ: Workfront app emails come from Adobe Workfront, permission emails from Adobe Experience Cloud. Either can land in spam filters depending on org config.
- "Unified Experience" onboarding gates notification visibility — for orgs not yet onboarded, comment tags and approval flows may notify users in-app only without emails.
- Approval-from-email flow is a power feature: approvers can decide without entering WFP. Useful for senior approvers who don't actively use Planning.
- Comments tagged to TEAMS notify all team members individually — could create notification volume if teams are large. Educate users on tag scope.
- No native digest mode for WFP notifications (unlike Workfront's daily digest). Each notification is real-time.
