#!/usr/bin/env node

/**
 * BPA Local Parser Script
 * 
 * Reads BPA CSV files from the local filesystem and creates a unified code transformer collection
 * that matches the cloud-adoption-service format.
 * 
 * Usage:
 *   node bpa-local-parser.js <bpa-csv-file-path> [output-directory]
 * 
 * Example:
 *   node bpa-local-parser.js ./cleaned_file6.csv ./unified-collections
 */

const fs = require('fs');
const path = require('path');

// Pattern to subtype mapping (matching cam-bpa-fetcher.ts)
const PATTERN_TO_SUBTYPE = {
  scheduler: "sling.commons.scheduler",
  assetApi: "unsupported.asset.api",
};

// CSV subtype to pattern mapping (based on actual CSV structure)
const CSV_SUBTYPE_TO_PATTERN = {
  "unsupported.asset.api": "assetApi",
  "javax.jcr.observation.EventListener": "eventListener", 
  "org.apache.sling.api.resource.observation.ResourceChangeListener": "resourceChangeListener",
  "org.osgi.service.event.EventHandler": "eventHandler"
};

// Known scheduler identifier
const SCHEDULER_IDENTIFIER = "org.apache.sling.commons.scheduler";

/**
 * Parse command line arguments
 */
function parseArgs() {
  const args = process.argv.slice(2);
  
  if (args.length < 1) {
    console.error('Usage: node bpa-local-parser.js <bpa-csv-file-path> [output-directory]');
    console.error('');
    console.error('Examples:');
    console.error('  node bpa-local-parser.js ./cleaned_file6.csv');
    console.error('  node bpa-local-parser.js ./cleaned_file6.csv ./unified-collections');
    process.exit(1);
  }
  
  return {
    bpaFilePath: args[0],
    outputDir: args[1] || './unified-collections'
  };
}

/**
 * Validate BPA file exists and is readable
 */
function validateBpaFile(filePath) {
  if (!fs.existsSync(filePath)) {
    throw new Error(`BPA file not found: ${filePath}`);
  }
  
  const stats = fs.statSync(filePath);
  if (!stats.isFile()) {
    throw new Error(`Path is not a file: ${filePath}`);
  }
  
  // Check if it's readable
  try {
    fs.accessSync(filePath, fs.constants.R_OK);
  } catch (error) {
    throw new Error(`BPA file is not readable: ${filePath}`);
  }
}

/**
 * Parse CSV line respecting quoted fields
 */
function parseCSVLine(line) {
  const result = [];
  let current = '';
  let inQuotes = false;
  let i = 0;
  
  while (i < line.length) {
    const char = line[i];
    
    if (char === '"') {
      if (inQuotes && line[i + 1] === '"') {
        // Escaped quote
        current += '"';
        i += 2;
      } else {
        // Toggle quote state
        inQuotes = !inQuotes;
        i++;
      }
    } else if (char === ',' && !inQuotes) {
      // Field separator
      result.push(current);
      current = '';
      i++;
    } else {
      current += char;
      i++;
    }
  }
  
  // Add the last field
  result.push(current);
  return result;
}

/**
 * Parse BPA CSV file
 */
function parseBpaFile(filePath) {
  try {
    const content = fs.readFileSync(filePath, 'utf8');
    const lines = content.split('\n').filter(line => line.trim());
    
    if (lines.length === 0) {
      throw new Error('Empty BPA file');
    }
    
    // Parse header
    const headers = parseCSVLine(lines[0]);
    console.log(`CSV Headers: ${headers.join(', ')}`);
    
    // Validate expected headers
    const expectedHeaders = ['code', 'type', 'subtype', 'importance', 'identifier', 'message', 'context'];
    const hasRequiredHeaders = expectedHeaders.every(header => headers.includes(header));
    
    if (!hasRequiredHeaders) {
      console.warn('CSV headers do not match expected format, proceeding with available headers');
    }
    
    // Parse data rows
    const findings = [];
    for (let i = 1; i < lines.length; i++) {
      const values = parseCSVLine(lines[i]);
      if (values.length >= headers.length) {
        const finding = {};
        headers.forEach((header, index) => {
          finding[header] = values[index] || '';
        });
        findings.push(finding);
      }
    }
    
    console.log(`Parsed ${findings.length} findings from CSV`);
    return { findings, headers };
  } catch (error) {
    throw new Error(`Error parsing BPA CSV file: ${error.message}`);
  }
}

/**
 * Extract findings from BPA CSV data
 */
function extractFindings(bpaData) {
  const findings = bpaData.findings || [];
  
  if (findings.length === 0) {
    console.warn('No findings found in BPA CSV data');
    return [];
  }
  
  console.log(`Found ${findings.length} findings in BPA CSV report`);
  return findings;
}

/**
 * Process scheduler findings from CSV
 */
function processSchedulerFindings(findings) {
  const schedulerFindings = findings.filter(finding => 
    finding.subtype === 'sling.commons.scheduler'
  );
  
  const identifiers = {};
  const classNames = [];
  
  schedulerFindings.forEach(finding => {
    // Extract class name from identifier
    const className = extractClassNameFromCsvFinding(finding);
    if (className && !classNames.includes(className)) {
      classNames.push(className);
    }
  });
  
  if (classNames.length > 0) {
    identifiers[SCHEDULER_IDENTIFIER] = classNames;
  }
  
  return {
    subtype: PATTERN_TO_SUBTYPE.scheduler,
    identifiers: identifiers
  };
}

/**
 * Process asset API findings from CSV
 */
function processAssetApiFindings(findings) {
  const assetApiFindings = findings.filter(finding => 
    finding.subtype === 'unsupported.asset.api'
  );
  
  const identifiers = {};
  
  assetApiFindings.forEach(finding => {
    // Extract class name from identifier (full path)
    const className = finding.identifier && isValidClassName(finding.identifier) ? finding.identifier.trim() : null;
    
    // Extract API method from message
    const apiMethod = extractAssetApiMethodFromMessage(finding.message);
    
    if (className && apiMethod) {
      if (!identifiers[apiMethod]) {
        identifiers[apiMethod] = [];
      }
      
      if (!identifiers[apiMethod].includes(className)) {
        identifiers[apiMethod].push(className);
      }
    }
  });
  
  return {
    subtype: PATTERN_TO_SUBTYPE.assetApi,
    identifiers: identifiers
  };
}

/**
 * Returns true if the value is a valid class name (excludes numeric-only values like "1", "4", "10").
 */
function isValidClassName(value) {
  if (!value || typeof value !== 'string') return false;
  const trimmed = value.trim();
  if (!trimmed) return false;
  // Exclude pure numbers (counts, line numbers, etc.)
  if (/^\d+$/.test(trimmed)) return false;
  return true;
}

/**
 * Extract full class identifier from CSV finding (returns complete path, not trimmed).
 */
function extractClassNameFromCsvFinding(finding) {
  // Prefer identifier field - return full path as-is
  if (finding.identifier && isValidClassName(finding.identifier)) {
    return finding.identifier.trim();
  }
  
  // Try to extract from message if identifier is not useful
  if (finding.message) {
    const classMatch = finding.message.match(/class\s+([a-zA-Z0-9_.]+)/);
    if (classMatch) {
      const className = classMatch[1];
      if (isValidClassName(className)) return className;
    }
  }
  
  return finding.identifier && isValidClassName(finding.identifier) ? finding.identifier.trim() : null;
}

/**
 * Extract Asset API method from message
 */
function extractAssetApiMethodFromMessage(message) {
  if (!message) return null;
  
  // Look for specific API methods mentioned in the message
  const apiMethods = [
    'com.day.cq.dam.api.AssetManager.createAsset',
    'com.day.cq.dam.api.AssetManager.removeAssetForBinary',
    'com.day.cq.dam.api.AssetManager.createAssetForBinary'
  ];
  
  for (const method of apiMethods) {
    if (message.includes(method)) {
      return method;
    }
  }
  
  // Generic fallback
  if (message.includes('AssetManager')) {
    return 'com.day.cq.dam.api.AssetManager';
  }
  
  return null;
}

/**
 * Process event listener findings from CSV
 */
function processEventListenerFindings(findings) {
  const eventListenerFindings = findings.filter(finding => 
    finding.subtype === 'javax.jcr.observation.EventListener'
  );
  
  const identifiers = {};
  const classNames = [];
  
  eventListenerFindings.forEach(finding => {
    const className = extractClassNameFromCsvFinding(finding);
    if (className && !classNames.includes(className)) {
      classNames.push(className);
    }
  });
  
  if (classNames.length > 0) {
    identifiers['javax.jcr.observation.EventListener'] = classNames;
  }
  
  return {
    subtype: 'javax.jcr.observation.EventListener',
    identifiers: identifiers
  };
}

/**
 * Process resource change listener findings from CSV
 */
function processResourceChangeListenerFindings(findings) {
  const resourceChangeListenerFindings = findings.filter(finding => 
    finding.subtype === 'org.apache.sling.api.resource.observation.ResourceChangeListener'
  );
  
  const identifiers = {};
  const classNames = [];
  
  resourceChangeListenerFindings.forEach(finding => {
    const className = extractClassNameFromCsvFinding(finding);
    if (className && !classNames.includes(className)) {
      classNames.push(className);
    }
  });
  
  if (classNames.length > 0) {
    identifiers['org.apache.sling.api.resource.observation.ResourceChangeListener'] = classNames;
  }
  
  return {
    subtype: 'org.apache.sling.api.resource.observation.ResourceChangeListener',
    identifiers: identifiers
  };
}

/**
 * Process event handler findings from CSV
 */
function processEventHandlerFindings(findings) {
  const eventHandlerFindings = findings.filter(finding => 
    finding.subtype === 'org.osgi.service.event.EventHandler'
  );
  
  const identifiers = {};
  const classNames = [];
  
  eventHandlerFindings.forEach(finding => {
    const className = extractClassNameFromCsvFinding(finding);
    if (className && !classNames.includes(className)) {
      classNames.push(className);
    }
  });
  
  if (classNames.length > 0) {
    identifiers['org.osgi.service.event.EventHandler'] = classNames;
  }
  
  return {
    subtype: 'org.osgi.service.event.EventHandler',
    identifiers: identifiers
  };
}

/**
 * Convert subtype to MongoDB-safe field name (matching cloud-adoption-service)
 */
function toMongoSafeFieldName(fieldName) {
  return fieldName ? fieldName.replace(/\./g, '_') : null;
}

/**
 * Convert identifier to MongoDB-safe field name (matching cloud-adoption-service)
 */
function toMongoSafeIdentifier(identifier) {
  return identifier ? identifier.replace(/\./g, '_') : null;
}

/**
 * Create unified collection structure (matching cloud-adoption-service format)
 */
function createUnifiedCollection(bpaData, outputDir) {
  const findings = extractFindings(bpaData);
  
  if (findings.length === 0) {
    console.warn('No findings to process');
    return;
  }
  
  // Ensure output directory exists
  if (!fs.existsSync(outputDir)) {
    fs.mkdirSync(outputDir, { recursive: true });
  }
  
  // Initialize unified subtypes structure
  const subtypes = {};
  let totalFindings = 0;
  
  // Process scheduler findings
  const schedulerCollection = processSchedulerFindings(findings);
  if (Object.keys(schedulerCollection.identifiers).length > 0) {
    const mongoSafeSubtype = toMongoSafeFieldName(schedulerCollection.subtype);
    subtypes[mongoSafeSubtype] = {};
    
    Object.entries(schedulerCollection.identifiers).forEach(([identifier, classNames]) => {
      const mongoSafeIdentifier = toMongoSafeIdentifier(identifier);
      subtypes[mongoSafeSubtype][mongoSafeIdentifier] = classNames;
      totalFindings += classNames.length;
    });
    
    console.log(`Found ${Object.values(schedulerCollection.identifiers).flat().length} scheduler classes`);
  }
  
  // Process asset API findings
  const assetApiCollection = processAssetApiFindings(findings);
  if (Object.keys(assetApiCollection.identifiers).length > 0) {
    const mongoSafeSubtype = toMongoSafeFieldName(assetApiCollection.subtype);
    subtypes[mongoSafeSubtype] = {};
    
    Object.entries(assetApiCollection.identifiers).forEach(([identifier, classNames]) => {
      const mongoSafeIdentifier = toMongoSafeIdentifier(identifier);
      subtypes[mongoSafeSubtype][mongoSafeIdentifier] = classNames;
      totalFindings += classNames.length;
    });
    
    console.log(`Found ${Object.values(assetApiCollection.identifiers).flat().length} asset API classes`);
  }
  
  // Process event listener findings
  const eventListenerCollection = processEventListenerFindings(findings);
  if (Object.keys(eventListenerCollection.identifiers).length > 0) {
    const mongoSafeSubtype = toMongoSafeFieldName(eventListenerCollection.subtype);
    subtypes[mongoSafeSubtype] = {};
    
    Object.entries(eventListenerCollection.identifiers).forEach(([identifier, classNames]) => {
      const mongoSafeIdentifier = toMongoSafeIdentifier(identifier);
      subtypes[mongoSafeSubtype][mongoSafeIdentifier] = classNames;
      totalFindings += classNames.length;
    });
    
    console.log(`Found ${Object.values(eventListenerCollection.identifiers).flat().length} event listener classes`);
  }
  
  // Process resource change listener findings
  const resourceChangeListenerCollection = processResourceChangeListenerFindings(findings);
  if (Object.keys(resourceChangeListenerCollection.identifiers).length > 0) {
    const mongoSafeSubtype = toMongoSafeFieldName(resourceChangeListenerCollection.subtype);
    subtypes[mongoSafeSubtype] = {};
    
    Object.entries(resourceChangeListenerCollection.identifiers).forEach(([identifier, classNames]) => {
      const mongoSafeIdentifier = toMongoSafeIdentifier(identifier);
      subtypes[mongoSafeSubtype][mongoSafeIdentifier] = classNames;
      totalFindings += classNames.length;
    });
    
    console.log(`Found ${Object.values(resourceChangeListenerCollection.identifiers).flat().length} resource change listener classes`);
  }
  
  // Process event handler findings
  const eventHandlerCollection = processEventHandlerFindings(findings);
  if (Object.keys(eventHandlerCollection.identifiers).length > 0) {
    const mongoSafeSubtype = toMongoSafeFieldName(eventHandlerCollection.subtype);
    subtypes[mongoSafeSubtype] = {};
    
    Object.entries(eventHandlerCollection.identifiers).forEach(([identifier, classNames]) => {
      const mongoSafeIdentifier = toMongoSafeIdentifier(identifier);
      subtypes[mongoSafeSubtype][mongoSafeIdentifier] = classNames;
      totalFindings += classNames.length;
    });
    
    console.log(`Found ${Object.values(eventHandlerCollection.identifiers).flat().length} event handler classes`);
  }
  
  // Create unified collection structure with metadata
  const subtypeKeys = Object.keys(subtypes);
  const unifiedCollection = {
    subtypes: subtypes,
    meta: {
      timestamp: new Date().toISOString(),
      source: 'local-bpa-parser',
      totalFindings: totalFindings,
      subtypeCount: subtypeKeys.length
    }
  };

  // Write unified collection file
  const unifiedPath = path.join(outputDir, 'unified-collection.json');
  fs.writeFileSync(unifiedPath, JSON.stringify(unifiedCollection, null, 2));
  console.log(`Created unified collection file: ${unifiedPath}`);

  return {
    subtypes: subtypeKeys,
    totalFindings,
    unifiedCollection
  };
}


/**
 * Main function
 */
function main() {
  try {
    const { bpaFilePath, outputDir } = parseArgs();
    
    console.log('BPA Local Parser');
    console.log('================');
    console.log(`BPA File: ${bpaFilePath}`);
    console.log(`Output Directory: ${outputDir}`);
    console.log('Format: Unified (cloud-adoption-service compatible)');
    console.log('');
    
    // Validate input file
    validateBpaFile(bpaFilePath);
    
    // Parse BPA file
    console.log('Parsing BPA CSV file...');
    const bpaData = parseBpaFile(bpaFilePath);
    
    // Create unified collection
    console.log('Creating unified collection...');
    const summary = createUnifiedCollection(bpaData, outputDir);
    
    console.log('');
    console.log('✅ Successfully created unified code transformer collection');
    console.log(`📁 Output directory: ${outputDir}`);
    console.log(`📊 Total subtypes: ${summary?.subtypes?.length || 0}`);
    console.log(`🎯 Total findings: ${summary?.totalFindings || 0}`);
    
    if (summary?.subtypes?.length > 0) {
      console.log('');
      console.log('Available subtypes:');
      summary.subtypes.forEach(subtype => {
        const subtypeData = summary.unifiedCollection?.subtypes?.[subtype];
        const count = subtypeData ? Object.values(subtypeData).flat().length : 0;
        console.log(`  - ${subtype}: ${count} classes`);
      });
    }
    
  } catch (error) {
    console.error('❌ Error:', error.message);
    process.exit(1);
  }
}

// Run the script if called directly
if (require.main === module) {
  main();
}

module.exports = {
  validateBpaFile,
  parseBpaFile,
  createUnifiedCollection,
  extractFindings
};
