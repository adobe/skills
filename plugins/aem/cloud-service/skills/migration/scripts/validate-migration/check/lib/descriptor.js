'use strict';

const { FAILURE_CLASSES } = require('../../failure-classes.js');
const { jarDsDescriptors } = require('./jar.js');

function descriptorAttributes(text) {
  const attributes = {};
  for (const match of text.matchAll(/([\w.:-]+)\s*=\s*(["'])(.*?)\2/g)) attributes[match[1]] = match[3];
  return attributes;
}

function descriptorProperty(xml, name) {
  const properties = /<(?:[\w.-]+:)?property\b([^>]*?)(?:\/>|>([\s\S]*?)<\/(?:[\w.-]+:)?property\s*>)/g;
  for (const match of xml.matchAll(properties)) {
    const attributes = descriptorAttributes(match[1]);
    if (attributes.name !== name) continue;
    const values = attributes.value === undefined ? (match[2] || '').split(/\r?\n/) : [attributes.value];
    return { present: true, array: attributes.value === undefined, type: attributes.type || 'String', values: values.map((value) => value.trim()).filter(Boolean) };
  }
  return { present: false, array: false, type: 'String', values: [] };
}

function descriptorProvides(xml, service) {
  return [...xml.matchAll(/<(?:[\w.-]+:)?provide\b([^>]*)>/g)].some((match) => descriptorAttributes(match[1]).interface === service);
}

// Extract the job.topics value from a single DS component descriptor.
function topicFromDescriptor(xml) {
  const property = descriptorProperty(xml, 'job.topics');
  return property.values.length ? property.values.join(', ') : null;
}

function componentContractFromDescriptor(xml, pattern) {
  const errors = [];
  const checks = {};
  const componentName = descriptorAttributes((xml.match(/<(?:[\w.-]+:)?component\b([^>]*)>/) || [])[1] || '').name;
  const services = {
    scheduler: ['java.lang.Runnable'],
    'event-migration': ['org.apache.sling.event.jobs.consumer.JobConsumer'],
    'resource-change-listener': ['org.apache.sling.api.resource.observation.ResourceChangeListener'],
  }[pattern];
  if (!services.some((service) => descriptorProvides(xml, service))) errors.push(`component must provide ${services.join(' or ')}`);
  const required = {
    scheduler: ['scheduler.expression', 'scheduler.runOn'],
    'event-migration': ['job.topics'],
    'resource-change-listener': ['resource.paths', 'resource.change.types'],
  }[pattern];
  for (const name of required) {
    const property = descriptorProperty(xml, name);
    if (!property.values.length || property.type !== 'String') errors.push(`${name} must contain nonempty String values`);
    checks[name.replace(/\./g, '_')] = property.values.join(', ');
  }
  if (pattern === 'scheduler') {
    const expression = descriptorProperty(xml, 'scheduler.expression');
    const runOn = descriptorProperty(xml, 'scheduler.runOn');
    const concurrent = descriptorProperty(xml, 'scheduler.concurrent');
    if (expression.array || expression.values.length !== 1) errors.push('scheduler.expression must have one scalar value');
    if (runOn.array || runOn.values.length !== 1 || !['SINGLE', 'LEADER'].includes(runOn.values[0])) errors.push('scheduler.runOn must be scalar SINGLE or LEADER');
    if (concurrent.present && (concurrent.array || concurrent.type !== 'Boolean' || concurrent.values.length !== 1 || !['true', 'false'].includes(concurrent.values[0]))) errors.push('scheduler.concurrent must be a scalar Boolean true or false');
    checks.scheduler_concurrent = concurrent.present ? concurrent.values.join(', ') : 'default';
  }
  if (pattern === 'resource-change-listener') {
    const changeTypes = descriptorProperty(xml, 'resource.change.types').values;
    if (changeTypes.some((value) => !['ADDED', 'CHANGED', 'REMOVED', 'PROVIDER_ADDED', 'PROVIDER_REMOVED'].includes(value))) errors.push('resource.change.types contains an unsupported change type');
  }
  return { errors, checks, componentName };
}

function sourceContractFailure(discovered) {
  if (!discovered.contract) {
    return { result: 'fail', failure_class: FAILURE_CLASSES.UNKNOWN, verification_level: 'source-only', evidence: 'built DS contract evidence unavailable; rerun --stage prepare with the same pattern and class scope' };
  }
  if (!discovered.contract.errors.length) return null;
  return { result: 'fail', failure_class: FAILURE_CLASSES.SOURCE_CONTRACT_MISMATCH, verification_level: 'source-only', evidence: discovered.contract.errors.join('; '), checks: discovered.contract.checks };
}

// Read the ResourceChangeListener contract flags from a DS component descriptor.
function rclFlagsFromDescriptor(xml) {
  return {
    hasPaths: descriptorProperty(xml, 'resource.paths').values.length > 0,
    hasChangeTypes: descriptorProperty(xml, 'resource.change.types').values.length > 0,
  };
}

// Component name declared by a DS descriptor, or null.
function componentName(xml) {
  const match = xml.match(/<scr:component[^>]*name="([^"]+)"/) || xml.match(/name="([^"]+)"/);
  return match ? match[1] : null;
}

// Return the DS descriptor xml whose component name === fqcn, or '' if none.
function dsDescriptorFor(jarPath, fqcn) {
  for (const [, xml] of jarDsDescriptors(jarPath)) {
    const implementation = descriptorAttributes((xml.match(/<(?:[\w.-]+:)?implementation\b([^>]*)>/) || [])[1] || '').class;
    if (componentName(xml) === fqcn || implementation === fqcn) return xml;
  }
  return '';
}

module.exports = { descriptorAttributes, descriptorProperty, descriptorProvides, topicFromDescriptor, componentContractFromDescriptor, sourceContractFailure, rclFlagsFromDescriptor, componentName, dsDescriptorFor };
