'use strict';

// Each pattern defines how to find its migrated artifact (`discover`) and how to
// check its contract (`verify`). Key order is the order patterns are listed.
module.exports = {
  'custom-templates': require('./custom-templates'),
  scheduler: require('./scheduler.js'),
  'asset-manager': require('./asset-manager.js'),
  'event-migration': require('./event-migration.js'),
  'resource-change-listener': require('./resource-change-listener.js'),
  replication: require('./replication.js'),
  'legacy-ui': require('./legacy-ui.js'),
  cdw: require('./cdw.js'),
};
