import sqlite3 from 'sqlite3';
import { open } from 'sqlite';

const dbPromise = open({
  filename: './chargers.db',
  driver: sqlite3.Database
});

const connectedClients = new Map();
const pendingChargingProfiles = new Map();

export {
  dbPromise,
  connectedClients,
  pendingChargingProfiles
};