import { ITransactionRepository } from '../database.js';
import { Database } from 'sqlite';
import {Transaction} from "../../model/transaction";

export class TransactionRepository implements ITransactionRepository {
  constructor(private db: Database) {}

  async getTransaction(transactionId: string): Promise<Transaction | null> {
    const row = await this.db.get('SELECT * FROM transactions WHERE transactionId = ?', transactionId);
    if (!row) {
      return null;
    }
    return new Transaction(
      row.transactionId,
      row.chargerId,
      row.idTag,
      row.meterStart,
      row.meterEnd,
      row.status,
      row.startTimestamp,
      row.stopTimestamp
    );
  }

  async getTransactions(filters: { chargerId?: string, status?: string }): Promise<Transaction[]> {
    const { chargerId, status } = filters;
    let query = 'SELECT * FROM transactions WHERE 1=1';
    const params: any[] = [];

    if (chargerId) {
      query += ' AND chargerId = ?';
      params.push(chargerId);
    }

    if (status) {
      query += ' AND status = ?';
      params.push(status);
    }

    const rows = await this.db.all(query, ...params);
    return rows.map(row => new Transaction(
      row.transactionId,
      row.chargerId,
      row.idTag,
      row.meterStart,
      row.meterEnd,
      row.status,
      row.startTimestamp,
      row.stopTimestamp
    ));
  }

  async addTransaction(transaction: Transaction): Promise<void> {
    await this.db.run('INSERT INTO transactions (transactionId, chargerId, idTag, meterStart) VALUES (?, ?, ?, ?)',
      transaction.transactionId, transaction.chargerId, transaction.idTag, transaction.meterStart);
  }

  async updateTransaction(transactionId: string, updates: Partial<Transaction>): Promise<void> {
    const { meterEnd, status } = updates;
    await this.db.run(`
        UPDATE transactions
        SET meterEnd = ?, status = ?
        WHERE transactionId = ?
    `, meterEnd, status, transactionId);
  }
}
