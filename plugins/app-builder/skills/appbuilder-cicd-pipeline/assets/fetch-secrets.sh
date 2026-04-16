#!/bin/bash
# fetch-secrets.sh — Extract App Builder CI/CD secret values from local workspace config
#
# Prerequisites:
#   1. aio CLI installed and logged in
#   2. Run `aio app use <workspace.json>` to configure .aio and .env
#   3. I/O Management API must be added to the workspace in Developer Console
#
# Usage:
#   chmod +x fetch-secrets.sh
#   cd /path/to/your/app-builder-project
#   ./fetch-secrets.sh
#
# Output: 14 secret values. Add workspace suffix (_STAGE, _PROD) when storing in GitHub.
#
# Source: https://developer.adobe.com/app-builder/docs/guides/app_builder_guides/deployment/cicd-using-github-actions

command -v jq >/dev/null 2>&1 || { echo "Error: jq is required but not installed." >&2; exit 1; }

main() {
    config=$(aio config ls --json)

    # Extract workspace services
    workspace_services=$(echo "$config" | jq -c '.project.workspace.details.services')

    # Check if I/O Management API is present
    if ! echo "$workspace_services" | jq -e 'any(.[]; .code == "AdobeIOManagementAPISDK")' > /dev/null; then
        echo "Error: I/O Management API was not found in your workspace." >&2
        echo "Add it in Developer Console: Project → Workspace → Add service → I/O Management API" >&2
        exit 1
    fi

    # Get the lowercase context name from the OAuth S2S credential
    ctx=$(echo "$config" \
        | jq -r '.project.workspace.details.credentials[] | select(.integration_type == "oauth_server_to_server") | .name' \
        | tr '[:upper:]' '[:lower:]'
    )

    if [ -z "$ctx" ]; then
        echo "Error: No OAuth Server-to-Server credential found in this workspace." >&2
        echo "Add I/O Management API to create one automatically." >&2
        exit 1
    fi

    echo "=== App Builder CI/CD Secrets ==="
    echo "Add the appropriate workspace suffix (_STAGE, _PROD) when storing in GitHub repository secrets."
    echo ""
    echo "CLIENTID:                                   $(echo "$config" | jq -r --arg ctx "$ctx" '.ims.contexts[$ctx].client_id')"
    echo "CLIENTSECRET:                               $(echo "$config" | jq -r --arg ctx "$ctx" '.ims.contexts[$ctx].client_secrets[0]')"
    echo "TECHNICALACCID:                             $(echo "$config" | jq -r --arg ctx "$ctx" '.ims.contexts[$ctx].technical_account_id')"
    echo "TECHNICALACCEMAIL:                          $(echo "$config" | jq -r --arg ctx "$ctx" '.ims.contexts[$ctx].technical_account_email')"
    echo "IMSORGID:                                   $(echo "$config" | jq -r --arg ctx "$ctx" '.ims.contexts[$ctx].ims_org_id')"
    echo "SCOPES:                                     $(echo "$config" | jq -r --arg ctx "$ctx" '.ims.contexts[$ctx].scopes | join(",")')"
    echo "AIO_RUNTIME_NAMESPACE:                      $(echo "$config" | jq -r '.runtime.namespace')"
    echo "AIO_RUNTIME_AUTH:                           $(echo "$config" | jq -r '.runtime.auth')"
    echo "AIO_PROJECT_ID:                             $(echo "$config" | jq -r '.project.id')"
    echo "AIO_PROJECT_NAME:                           $(echo "$config" | jq -r '.project.name')"
    echo "AIO_PROJECT_ORG_ID:                         $(echo "$config" | jq -r '.project.org.id')"
    echo "AIO_PROJECT_WORKSPACE_ID:                   $(echo "$config" | jq -r '.project.workspace.id')"
    echo "AIO_PROJECT_WORKSPACE_NAME:                 $(echo "$config" | jq -r '.project.workspace.name')"
    echo "AIO_PROJECT_WORKSPACE_DETAILS_SERVICES:     $(echo "$config" | jq -r -c '.project.workspace.details.services')"
}

main
