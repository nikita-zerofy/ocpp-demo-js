import sqlite3 from 'sqlite3';
import { open } from 'sqlite';
import {ChargerRepository} from "./repository/sqlite/charger-repository.js";
import {TransactionRepository} from "./repository/sqlite/transaction-repository.js";

const dbPromise = open({
  filename: './chargers.db',
  driver: sqlite3.Database
});

const connectedClients = new Map();
const pendingChargingProfiles = new Map();

const createChargerRepository = async () => {
  const db = await dbPromise;
  return new ChargerRepository(db);
}

const createTransactionRepository = async () => {
  const db = await dbPromise;
  return new TransactionRepository(db);
}

export {
  dbPromise,
  connectedClients,
  pendingChargingProfiles,
  createChargerRepository,
  createTransactionRepository
};