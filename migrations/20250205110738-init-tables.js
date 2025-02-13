'use strict';

var dbm;
var type;
var seed;

/**
 * We receive the dbmigrate dependency from dbmigrate initially.
 * This enables us to not have to rely on NODE_PATH.
 */
exports.setup = function (options, seedLink) {
  dbm = options.dbmigrate;
  type = dbm.dataType;
  seed = seedLink;
};

exports.up = function (db) {
  return db.createTable('chargers', {
    identity: {type: 'string', primaryKey: true},
    userId: {type: 'string', length: 255},
    dwellingId: {type: 'string', length: 255},
    serviceId: {type: 'string', length: 255},
    projectId: {type: 'string'},
    vendor: {type: 'string'},
    model: {type: 'string'},
    serialNumber: {type: 'string'},
    firmwareVersion: {type: 'string'},
    lastHeartbeat: {type: 'datetime'},
    lastStatus: {type: 'string'},
    lastStatusTimestamp: {type: 'datetime'},
    errorCode: {type: 'string'},
    firstBootNotificationReceived: {type: 'boolean', defaultValue: false}
  });
};

exports.down = function (db) {
  return db.dropTable('chargers');
};

exports._meta = {
  "version": 1
};
