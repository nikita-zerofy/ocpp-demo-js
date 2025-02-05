'use strict';

var dbm;
var type;
var seed;

/**
  * We receive the dbmigrate dependency from dbmigrate initially.
  * This enables us to not have to rely on NODE_PATH.
  */
exports.setup = function(options, seedLink) {
  dbm = options.dbmigrate;
  type = dbm.dataType;
  seed = seedLink;
};

exports.up = function (db) {
  return db.runSql(`
    ALTER TABLE chargers ADD COLUMN vendor TEXT;
    ALTER TABLE chargers ADD COLUMN model TEXT;
    ALTER TABLE chargers ADD COLUMN serialNumber TEXT;
    ALTER TABLE chargers ADD COLUMN firmwareVersion TEXT;
    ALTER TABLE chargers ADD COLUMN lastHeartbeat DATETIME;
    ALTER TABLE chargers ADD COLUMN lastStatus TEXT;
    ALTER TABLE chargers ADD COLUMN lastStatusTimestamp DATETIME;
    ALTER TABLE chargers ADD COLUMN errorCode TEXT;
  `);
};

exports.down = function (db) {
  return db.runSql(`
    ALTER TABLE chargers DROP COLUMN vendor;
    ALTER TABLE chargers DROP COLUMN model;
    ALTER TABLE chargers DROP COLUMN serialNumber;
    ALTER TABLE chargers DROP COLUMN firmwareVersion;
    ALTER TABLE chargers DROP COLUMN lastHeartbeat;
    ALTER TABLE chargers DROP COLUMN lastStatus;
    ALTER TABLE chargers DROP COLUMN lastStatusTimestamp;
    ALTER TABLE chargers DROP COLUMN errorCode;
  `);
};

exports._meta = {
  "version": 1
};
