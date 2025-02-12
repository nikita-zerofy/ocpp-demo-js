import {Charger} from "../model/charger";
import {Transaction} from "../model/transaction";

export interface IChargerRepository {
  getCharger(chargerId: string): Promise<any>;
  addCharger(charger: any): Promise<void>;
  updateCharger(chargerId: string, updates: Charger): Promise<void>;
  getAllChargers(): Promise<Charger[]>;
}

export interface ITransactionRepository {
  getTransaction(transactionId: string): Promise<any>;
  getTransactions(filters: { chargerId?: string, status?: string }): Promise<Transaction[]>;
  addTransaction(transaction: Transaction): Promise<void>;
  updateTransaction(transactionId: string, updates: Partial<Transaction>): Promise<void>;
}
