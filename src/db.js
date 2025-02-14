import sqlite3 from 'sqlite3';
import {open} from 'sqlite';
import {SqliteChargerRepository} from './repository/sqlite/sqlite-charger-repository';
import {SqliteTransactionRepository} from './repository/sqlite/sqlite-transaction-repository';

const dbPromise = open({
  filename: './chargers.db',
  mode: sqlite3.OPEN_READWRITE,
  driver: sqlite3.Database,
});

const connectedClients = new Map();
const pendingChargingProfiles = new Map();

let chargerRepository;
let transactionRepository;

(async () => {
  const db = await dbPromise;
  chargerRepository = new SqliteChargerRepository(db);
  transactionRepository = new SqliteTransactionRepository(db);
})();

export {dbPromise, connectedClients, pendingChargingProfiles, chargerRepository, transactionRepository};
