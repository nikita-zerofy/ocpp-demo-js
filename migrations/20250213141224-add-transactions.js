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
  return db.createTable('transactions', {
    transactionId: {type: 'string', primaryKey: true},
    identity: {type: 'string'},
    idTag: {type: 'string'},
    meterStart: {type: 'int'},
    meterEnd: {type: 'int', nullable: true},
    status: {type: 'string', nullable: true},
    startTimestamp: {type: 'datetime', nullable: true},
    stopTimestamp: {type: 'datetime', nullable: true},
  });
};

exports.down = function (db) {
  return db.dropTable('transactions');
};

exports._meta = {
  version: 1,
};
