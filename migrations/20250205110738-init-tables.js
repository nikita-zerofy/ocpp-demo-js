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
    CREATE TABLE IF NOT EXISTS chargers (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      userId TEXT NOT NULL,
      chargerId TEXT NOT NULL UNIQUE
    );

    CREATE TABLE IF NOT EXISTS transactions (
      transactionId INTEGER PRIMARY KEY AUTOINCREMENT,
      chargerId TEXT NOT NULL,
      idTag TEXT NOT NULL,
      startTimestamp DATETIME DEFAULT CURRENT_TIMESTAMP,
      stopTimestamp DATETIME,
      meterStart INTEGER,
      meterEnd INTEGER,
      status TEXT CHECK(status IN ('active', 'completed', 'suspended')) DEFAULT 'active',
      FOREIGN KEY (chargerId) REFERENCES chargers(chargerId)
      );
  `);
};

exports.down = function (db) {
  return db.runSql(`
    DROP TABLE IF EXISTS transactions;
    DROP TABLE IF EXISTS chargers;
  `);
};

exports._meta = {
  "version": 1
};
