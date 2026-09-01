'use strict';

/**
 * Event migration SOURCE invariant — from code-assessment/event-migration/SKILL.md.
 * A CS EventHandler must stay lightweight: handleEvent() offloads to a Sling Job,
 * never runs heavy work inline on the shared OSGi thread, and does not subscribe
 * to resource topics (use resource-change-listener for those).
 *   - offloads to a job: JobManager + addJob(...)
 *   - not a raw JCR EventListener
 *   - does not subscribe to org/apache/sling/api/resource/Resource/* topics
 */
function checkEventMigrationSource(src) {
  const offloads = /JobManager/.test(src) && /addJob\s*\(/.test(src);
  const jcrListener = /javax\.jcr\.observation\.EventListener/.test(src);
  const resourceTopic = /resource\/Resource\/(ADDED|CHANGED|REMOVED)/.test(src);
  const checks = { offloads_to_job: offloads, not_jcr_listener: !jcrListener, no_resource_topic: !resourceTopic };

  if (jcrListener) return { result: 'fail', failure_class: 'source.jcr_event_listener', checks,
    evidence: 'uses javax.jcr.observation.EventListener — migrate to EventHandler/RCL' };
  if (resourceTopic) return { result: 'fail', failure_class: 'source.resource_topic', checks,
    evidence: 'subscribes to a resource topic — use ResourceChangeListener instead' };
  if (!offloads) return { result: 'fail', failure_class: 'source.no_job_offload', checks,
    evidence: 'handleEvent() does not offload to a Sling Job (blocks the shared event thread)' };
  return { result: 'pass', failure_class: null, checks };
}

module.exports = { checkEventMigrationSource };
