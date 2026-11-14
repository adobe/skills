'use strict';

/**
 * mcp.js — AEM Quickstart MCP server constants. The server exposes
 * `diagnose-osgi-bundle` at <sdk>/bin/mcp; every runtime pattern needs it. The user
 * adds it to their coding assistant, which confirms readiness by listing the tool.
 */
const REQUIRED_TOOL = 'diagnose-osgi-bundle';

module.exports = { REQUIRED_TOOL };
