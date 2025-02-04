import sqlite3 from 'sqlite3';
import { open } from 'sqlite';
import logger from './logger.js';

const dbPromise = open({
  filename: './chargers.db',
  driver: sqlite3.Database
});

const connectedClients = new Map();
const pendingChargingProfiles = new Map();

async function initDB() {
  const db = await dbPromise;
  await db.exec(`
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
  logger.info('SQLite: tables initialized');
}

export {
  dbPromise,
  initDB,
  connectedClients,
  pendingChargingProfiles
};