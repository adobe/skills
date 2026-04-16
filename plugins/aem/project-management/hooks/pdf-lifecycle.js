#!/usr/bin/env node

/**
 * PDF Lifecycle Hook
 *
 * Manages the lifecycle of markdown-to-PDF conversion for project handover docs.
 *
 * Hook Events:
 * - PostToolUse (Write|Edit): Tracks .md files in content/ for PDF conversion
 * - Stop: Blocks if .md files exist without corresponding .pdf, reminds to run whitepaper
 * - SessionEnd: Cleans up leftover .md and .plain.html files after PDF exists
 */

import fs from 'fs';
import path from 'path';
import os from 'os';

/**
 * Check if current directory is the root of an AEM Edge Delivery Services project.
 * Returns: { isRoot: boolean, foundInParent: boolean, projectRoot: string|null }
 */
function checkEdgeDeliveryProject() {
  const cwd = process.cwd();

  // Check if at project root
  if (fs.existsSync(path.join(cwd, 'scripts/aem.js'))) {
    return { isRoot: true, foundInParent: false, projectRoot: cwd };
  }

  // Walk up to see if we're in a nested folder of an Edge Delivery project
  let dir = path.dirname(cwd);
  const root = path.parse(dir).root;

  while (dir !== root) {
    if (fs.existsSync(path.join(dir, 'scripts/aem.js'))) {
      return { isRoot: false, foundInParent: true, projectRoot: dir };
    }
    dir = path.dirname(dir);
  }

  return { isRoot: false, foundInParent: false, projectRoot: null };
}

// Session-scoped file paths
let sessionId = 'default';
let TRACKING_FILE = path.join(os.tmpdir(), `project-mgmt-pdf-tracking-${sessionId}.txt`);
let DEBUG_LOG_FILE = path.join(os.tmpdir(), `project-mgmt-pdf-debug-${sessionId}.log`);

/**
 * Initialize session-scoped file paths
 */
function initSessionFiles(hookInput) {
  sessionId = hookInput?.session_id || 'default';
  TRACKING_FILE = path.join(os.tmpdir(), `project-mgmt-pdf-tracking-${sessionId}.txt`);
  DEBUG_LOG_FILE = path.join(os.tmpdir(), `project-mgmt-pdf-debug-${sessionId}.log`);
}

/**
 * Read JSON input from stdin
 */
async function readStdin() {
  return new Promise((resolve, reject) => {
    const chunks = [];
    process.stdin.on('data', (chunk) => chunks.push(chunk));
    process.stdin.on('end', () => {
      try {
        const data = Buffer.concat(chunks).toString('utf-8');
        resolve(JSON.parse(data));
      } catch (error) {
        reject(new Error(`Failed to parse stdin JSON: ${error.message}`));
      }
    });
    process.stdin.on('error', reject);
  });
}

/**
 * Log to debug file
 */
function debugLog(message, data = null) {
  const timestamp = new Date().toISOString();
  const logEntry = data
    ? `[${timestamp}] ${message}\n${JSON.stringify(data, null, 2)}\n`
    : `[${timestamp}] ${message}\n`;
  try {
    fs.appendFileSync(DEBUG_LOG_FILE, logEntry);
  } catch (err) {
    // Ignore logging errors
  }
}

/**
 * Check if file is a trackable handover guide markdown file
 * Only tracks specific guide files created by this plugin
 */
function isTrackableMarkdownFile(filePath) {
  if (!filePath || !filePath.endsWith('.md')) return false;

  // Only track specific handover guide files
  const basename = path.basename(filePath);
  const allowedFiles = ['AUTHOR-GUIDE.md', 'DEVELOPER-GUIDE.md', 'ADMIN-GUIDE.md'];
  if (!allowedFiles.includes(basename)) return false;

  // Check if file is in project-guides/ relative to project root
  const cwd = process.cwd();
  const relativePath = path.relative(cwd, filePath);
  return relativePath.startsWith('project-guides' + path.sep) ||
         relativePath.startsWith('project-guides/');
}

/**
 * Load tracked files (deduplicated)
 */
function loadTrackedFiles() {
  try {
    if (fs.existsSync(TRACKING_FILE)) {
      const content = fs.readFileSync(TRACKING_FILE, 'utf-8');
      const lines = content.split('\n').filter(line => line.trim());
      return new Set(lines);
    }
  } catch (err) {
    debugLog(`Error loading tracked files: ${err.message}`);
  }
  return new Set();
}

/**
 * Track a file by appending to tracking file
 */
function trackFile(filePath) {
  try {
    fs.appendFileSync(TRACKING_FILE, filePath + '\n');
    return loadTrackedFiles().size;
  } catch (err) {
    debugLog(`Error tracking file: ${err.message}`);
    return 0;
  }
}

/**
 * Clear tracked files
 */
function clearTrackedFiles() {
  try {
    if (fs.existsSync(TRACKING_FILE)) {
      fs.unlinkSync(TRACKING_FILE);
    }
  } catch (err) {
    debugLog(`Error clearing tracked files: ${err.message}`);
  }
}

/**
 * Handle PostToolUse - track markdown files
 */
function handlePostToolUse(filePath) {
  if (isTrackableMarkdownFile(filePath)) {
    const totalTracked = trackFile(filePath);
    debugLog(`Tracking file for PDF conversion: ${filePath} (${totalTracked} total)`);

    console.log(JSON.stringify({
      success: true,
      action: 'tracked',
      file: filePath,
      message: `Tracked ${path.basename(filePath)} for PDF conversion`
    }));
  }
}

/**
 * Clean up auth token from project config (security: don't leave credentials behind)
 */
function cleanupAuthToken() {
  const configPath = path.join(process.cwd(), '.claude-plugin/project-config.json');
  if (fs.existsSync(configPath)) {
    try {
      const config = JSON.parse(fs.readFileSync(configPath, 'utf-8'));
      if (config.authToken) {
        delete config.authToken;
        fs.writeFileSync(configPath, JSON.stringify(config, null, 2));
        debugLog('Removed auth token from project config');
        return true;
      }
    } catch (err) {
      debugLog(`Error cleaning auth token: ${err.message}`);
    }
  }
  return false;
}

/**
 * Handle Stop - check for pending PDF conversions
 */
function handleStop() {
  const trackedFiles = loadTrackedFiles();

  if (trackedFiles.size === 0) {
    debugLog('No tracked markdown files');
    console.log(JSON.stringify({
      reason: 'No pending PDF conversions'
    }));
    return;
  }

  // Check which tracked .md files still exist (not yet converted/cleaned)
  const pendingFiles = [];
  for (const mdFile of trackedFiles) {
    if (fs.existsSync(mdFile)) {
      const pdfFile = mdFile.replace(/\.md$/, '.pdf');
      if (!fs.existsSync(pdfFile)) {
        pendingFiles.push(mdFile);
      }
    }
  }

  if (pendingFiles.length === 0) {
    debugLog('All tracked files have been converted to PDF');
    clearTrackedFiles();
    const tokenCleaned = cleanupAuthToken();
    console.log(JSON.stringify({
      reason: 'All markdown files converted to PDF' + (tokenCleaned ? '. Auth token cleaned up.' : '')
    }));
    return;
  }

  // Warn about pending conversions (but allow stop)
  let msg = `${pendingFiles.length} markdown file(s) have not been converted to PDF yet:\n\n`;
  for (const mdFile of pendingFiles) {
    msg += `  - ${mdFile}\n`;
  }
  msg += '\nTo generate PDFs, invoke the whitepaper skill for each file.';

  debugLog(`Warning - pending files: ${pendingFiles.join(', ')}`);
  console.log(JSON.stringify({
    decision: 'warn',
    reason: msg
  }));
}

/**
 * Handle SessionEnd - cleanup leftover source files
 */
function handleSessionEnd() {
  const trackedFiles = loadTrackedFiles();
  let cleanedCount = 0;

  for (const mdFile of trackedFiles) {
    const pdfFile = mdFile.replace(/\.md$/, '.pdf');

    // Only cleanup if PDF exists
    if (!fs.existsSync(pdfFile)) {
      debugLog(`Skipping cleanup for ${mdFile} - PDF doesn't exist`);
      continue;
    }

    // Delete .md file
    if (fs.existsSync(mdFile)) {
      try {
        fs.unlinkSync(mdFile);
        debugLog(`Deleted: ${mdFile}`);
        cleanedCount++;
      } catch (err) {
        debugLog(`Error deleting ${mdFile}: ${err.message}`);
      }
    }

    // Delete .plain.html file
    const plainHtmlFile = mdFile.replace(/\.md$/, '.plain.html');
    if (fs.existsSync(plainHtmlFile)) {
      try {
        fs.unlinkSync(plainHtmlFile);
        debugLog(`Deleted: ${plainHtmlFile}`);
      } catch (err) {
        debugLog(`Error deleting ${plainHtmlFile}: ${err.message}`);
      }
    }

    // Delete .html file (PDF is the only deliverable)
    const htmlFile = mdFile.replace(/\.md$/, '.html');
    if (fs.existsSync(htmlFile)) {
      try {
        fs.unlinkSync(htmlFile);
        debugLog(`Deleted: ${htmlFile}`);
      } catch (err) {
        debugLog(`Error deleting ${htmlFile}: ${err.message}`);
      }
    }
  }

  clearTrackedFiles();
  const tokenCleaned = cleanupAuthToken();
  debugLog(`SessionEnd cleanup complete: ${cleanedCount} file(s) cleaned, token cleaned: ${tokenCleaned}`);

  console.log(JSON.stringify({
    success: true,
    cleaned: cleanedCount,
    tokenCleaned
  }));
}

/**
 * Main hook logic
 */
async function main() {
  const projectCheck = checkEdgeDeliveryProject();

  // Silent no-op for non-Edge Delivery projects (good citizen in multi-plugin environments)
  if (!projectCheck.isRoot && !projectCheck.foundInParent) {
    process.exit(0);
  }

  // Nested folder - auto-navigate to project root
  if (!projectCheck.isRoot && projectCheck.foundInParent) {
    process.chdir(projectCheck.projectRoot);
  }

  try {
    const hookInput = await readStdin();
    initSessionFiles(hookInput);

    debugLog('=== PDF Lifecycle Hook invoked ===');
    debugLog('Received hook input', hookInput);

    const hookEvent = hookInput?.hook_event_name || hookInput?.hook_event || 'PostToolUse';
    debugLog(`Hook event: ${hookEvent}`);

    if (hookEvent === 'Stop') {
      handleStop();
    } else if (hookEvent === 'SessionEnd') {
      handleSessionEnd();
    } else {
      // PostToolUse
      const filePath = hookInput?.tool_input?.file_path;
      if (filePath) {
        handlePostToolUse(filePath);
      }
    }
  } catch (error) {
    debugLog(`Unexpected error: ${error.message}`, { stack: error.stack });
    console.log(JSON.stringify({ success: false, error: error.message }));
    process.exit(0);
  }
}

main();
