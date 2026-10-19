'use strict';

/**
 * mcp.js — AEM Quickstart MCP server constants. The server exposes
 * `diagnose-osgi-bundle` at <sdk>/bin/mcp; every runtime pattern needs it. The user
 * adds it to their coding assistant, which confirms readiness by listing the tool.
 */
const MCP_PACKAGE = 'com.adobe.aem:com.adobe.aem.mcp-server-contribs-content';
const MCP_MAVEN_URL = 'https://repo1.maven.org/maven2/com/adobe/aem/com.adobe.aem.mcp-server-contribs-content/';
const MCP_VERSIONS_URL = 'https://github.com/adobe/cq-quickstart-mcp-server#supported-versions';
const MCP_DOC_URL = 'https://experienceleague.adobe.com/en/docs/experience-manager-cloud-service/content/ai-in-aem/local-development-with-ai-tools#aem-quickstart-mcp-server';
const REQUIRED_TOOL = 'diagnose-osgi-bundle';

module.exports = { MCP_PACKAGE, MCP_MAVEN_URL, MCP_VERSIONS_URL, MCP_DOC_URL, REQUIRED_TOOL };
