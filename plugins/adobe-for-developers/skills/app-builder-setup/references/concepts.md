# App Builder concepts, in plain words

Use these one-liners when a term first comes up. Don't paste the whole file.

| Term | Plain explanation |
|---|---|
| App Builder | Adobe's platform for building apps and extensions that run inside Adobe products (Experience Cloud, AEM, Workfront). Adobe hosts the app's backend and UI. |
| Adobe I/O CLI (`aio`) | The command-line tool that creates, runs and deploys App Builder apps from your machine. |
| CLI sign-in (`aio login`) | Connects the CLI to your Adobe account. It's separate from the connector's sign-in in your AI assistant, so both must use the same Adobe account. |
| Organization (org) | Your company's Adobe account. Projects, APIs and permissions belong to an org. |
| Environment | Adobe's production systems (what customers use) or its stage systems (Adobe-internal testing). The CLI and the connector must point at the same one. |
| Adobe Developer Terms of Use | Adobe's terms for building on its platform. They're accepted once per person and org. Projects can't be created until they're accepted. |
| Project | The container in Adobe Developer Console that holds your app's settings, APIs and credentials. |
| Workspace | A separate copy of the project's settings. App Builder projects get **Stage** (for testing) and **Production** (for real users). Each has its own URLs, credentials and APIs. |
| Runtime namespace | The private space in Adobe's serverless platform (I/O Runtime) where the app's backend code runs. Each workspace has its own. |
| Action | One backend function of your app. It runs on I/O Runtime when it's called. |
| Extension point | The place in an Adobe product where your app plugs in, for example the Experience Cloud Shell menu or a button in the AEM Content Fragment console. |
| Local run (`aio app dev`) | Runs the UI and actions on your own computer, for trying things out. Nothing is uploaded. |
| Deploy | Uploads the app to a workspace (Stage or Production) so it runs on Adobe's servers. |
| Publish to the org | Makes a Production app visible to everyone in the org. A developer submits it for approval in Developer Console, and an org admin approves it in Adobe Exchange. Deploying alone does not do this. |
| Activation | One recorded run of an action, with its result, duration and logs. |

## Access only an admin can grant

| Missing | Who fixes it | What to ask for |
|---|---|---|
| App Builder for the org | The org's Adobe account team, or a system admin (a free trial is available at https://developer.adobe.com/app-builder/trial/) | "Please enable App Builder for our org." |
| Permission to create projects | A system admin in Adobe Admin Console (https://adminconsole.adobe.com) | "Please add me as a Developer for App Builder in Admin Console." |
| Access to the target product (AEM, Workfront) | The product admin | "Please give me access to <product> so I can preview my extension." |
