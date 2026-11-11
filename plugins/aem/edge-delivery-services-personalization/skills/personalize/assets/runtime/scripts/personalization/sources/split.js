/*
 * `split` source: a section A/B test (contract section 6a). The default is
 * the control. A visitor is drawn on the first view in a browser session and
 * keeps the arm for the session: sessionStorage pzn-split:<id>, mirrored in
 * the pzn-split session cookie the edge reads and writes. The assignment is
 * stored, so it needs consent (or the approved `split` exception); without
 * either the visitor is not assigned. Bots are never assigned.
 */

import { parseCookies, COOKIE_SPLIT, SPLIT_STORAGE_PREFIX } from '../context.js';
import { assignSplit } from '../section-spec.js';

export const STORAGE_PREFIX = SPLIT_STORAGE_PREFIX;
export const COOKIE = COOKIE_SPLIT;

/**
 * Reads the assignments of a pzn-split cookie value: `id:arm,id:arm`.
 * @param {string} value
 * @returns {object} id -> arm
 */
export function parseAssignments(value) {
  return Object.fromEntries(String(value || '').split(',')
    .map((pair) => pair.split(':').map((part) => part.trim()))
    .filter(([id, arm]) => id && arm));
}

/**
 * @param {object} assignments id -> arm
 * @returns {string} cookie value
 */
export function formatAssignments(assignments) {
  return Object.entries(assignments).map(([id, arm]) => `${id}:${arm}`).join(',');
}

function stored(id) {
  try {
    const value = window.sessionStorage.getItem(STORAGE_PREFIX + id);
    if (value) return value;
  } catch (e) {
    // storage blocked: fall back to the cookie
  }
  return parseAssignments(parseCookies(document.cookie)[COOKIE])[id];
}

function remember(id, arm) {
  try {
    window.sessionStorage.setItem(STORAGE_PREFIX + id, arm);
  } catch (e) {
    // storage blocked: the cookie still keeps the assignment
  }
  const assignments = { ...parseAssignments(parseCookies(document.cookie)[COOKIE]), [id]: arm };
  document.cookie = `${COOKIE}=${encodeURIComponent(formatAssignments(assignments))}; path=/; SameSite=Lax; Secure`;
}

/**
 * The visitor's arm for a split section, kept for the session.
 * @param {object} spec
 * @param {{random?: () => number}} [options]
 * @returns {string} variant name or 'default'
 */
export function splitArm(spec, { random = Math.random } = {}) {
  const arm = assignSplit(spec, stored(spec.id), random());
  remember(spec.id, arm);
  return arm;
}
