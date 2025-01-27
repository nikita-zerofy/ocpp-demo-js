import sqlite3 from 'sqlite3';
import {open} from 'sqlite';
import logger from './logger.js';

const dbPromise = open({
  filename: './chargers.db',
  driver: sqlite3.Database
});

const connectedClients = new Map();

async function initDB() {
  const db = await dbPromise;
  await db.exec(`
    CREATE TABLE IF NOT EXISTS chargers (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      userId TEXT NOT NULL,
      chargerId TEXT NOT NULL UNIQUE,
    );
  `);
  logger.info('SQLite: chargers table ready');
}

export {
  dbPromise,
  initDB,
  connectedClients
};
