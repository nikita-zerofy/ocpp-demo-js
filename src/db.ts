import sqlite3 from 'sqlite3';
import {open, Database} from 'sqlite';
import {SqliteChargerRepository} from './repository/sqlite/sqlite-charger-repository';
import admin from 'firebase-admin';
import {getFirestore} from 'firebase-admin/firestore';
import {FireormChargerRepository} from './repository/firestore/firestore-charger-repository';
import {SqliteTransactionRepository} from './repository/sqlite/sqlite-transaction-repository';

const app = admin.initializeApp({
  credential: admin.credential.applicationDefault(),
  projectId: 'zerofy-energy-dev',
});

const firestore = getFirestore(app, 'zerofy-ocpp');

const dbPromise: Promise<Database> = open({
  filename: './chargers.db',
  mode: sqlite3.OPEN_READWRITE,
  driver: sqlite3.Database,
});

export const connectedClients: Map<string, any> = new Map();
export const pendingChargingProfiles: Map<string, any> = new Map();

/**
 * Initializes and returns SQLite-based repositories.
 */
export async function initializeSQLiteRepositories() {
  const db = await dbPromise;
  const chargerRepository = new SqliteChargerRepository(db);
  const transactionRepository = new SqliteTransactionRepository(db);
  return {chargerRepository, transactionRepository, connectedClients, pendingChargingProfiles};
}

/**
 * Initializes Firestore-based repositories using Fireorm.
 * Assumes you have Fireorm models (e.g. Charger and Transaction) defined.
 */
export async function initializeFirestoreRepositories() {
  const {initialize, getRepository} = await import('fireorm');
  const {Charger} = await import('./repository/firestore/firestore-charger');

  initialize(firestore);

  const baseChargerRepository = getRepository(Charger);
  const chargerRepository = new FireormChargerRepository(baseChargerRepository);
  return {chargerRepository, firestore};
}
