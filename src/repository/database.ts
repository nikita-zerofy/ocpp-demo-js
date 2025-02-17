import {Charger} from '../model/charger';
import {Transaction} from '../model/transaction';

export interface ChargerRepository {
  getCharger(identity: string): Promise<Charger | null>;
  addCharger(charger: Charger): Promise<void>;
  updateCharger(identity: string, updates: Charger): Promise<void>;
  getAllChargers(): Promise<Charger[]>;
  deleteCharger(identity: string): Promise<void>;
}

export interface TransactionRepository {
  getTransaction(transactionId: string): Promise<Transaction | null>;
  getTransactions(filters: {identity?: string; status?: string}): Promise<Transaction[]>;
  addTransaction(transaction: Transaction): Promise<void>;
  updateTransaction(transactionId: string, updates: Partial<Transaction>): Promise<void>;
}
