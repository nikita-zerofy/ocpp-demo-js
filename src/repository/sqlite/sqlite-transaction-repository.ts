import {TransactionRepository} from '../database.js';
import {Database} from 'sqlite';
import {Transaction} from '../../model/transaction';
import logger from '../../logger';

export class SqliteTransactionRepository implements TransactionRepository {
  constructor(private db: Database) {
    logger.info('SqliteTransactionRepository instantiated.');
  }

  async getTransaction(transactionId: string): Promise<Transaction | null> {
    logger.info(`Entering getTransaction with transactionId: ${transactionId}`);
    try {
      const row = await this.db.get('SELECT * FROM transactions WHERE transactionId = ?', transactionId);
      logger.debug(`Query result for transactionId ${transactionId}: ${JSON.stringify(row)}`);

      if (!row) {
        logger.info(`No transaction found for transactionId: ${transactionId}`);
        return null;
      }

      const transaction = {
        transactionId: row.transactionId,
        identity: row.identity,
        idTag: row.idTag,
        meterStart: row.meterStart,
        meterEnd: row.meterEnd,
        status: row.status,
        startTimestamp: row.startTimestamp,
        stopTimestamp: row.stopTimestamp,
      };
      logger.info(`Transaction retrieved for transactionId: ${transactionId}`);
      return transaction;
    } catch (error) {
      logger.error(`Error in getTransaction for transactionId: ${transactionId}`, error);
      throw error;
    }
  }

  async getTransactions(filters: {identity?: string; status?: string}): Promise<Transaction[]> {
    logger.info(`Entering getTransactions with filters: ${JSON.stringify(filters)}`);
    try {
      const {identity, status} = filters;
      let query = 'SELECT * FROM transactions';
      const params: any[] = [];

      if (identity) {
        query += ' AND identity = ?';
        params.push(identity);
      }

      if (status) {
        query += ' AND status = ?';
        params.push(status);
      }

      logger.info(`Executing query: ${query} with params: ${JSON.stringify(params)}`);
      const rows = await this.db.all(query, ...params);
      logger.info(`Query result: ${JSON.stringify(rows)}`);

      const transactions = rows.map((row) => {
        return {
          transactionId: row.transactionId,
          identity: row.identity,
          idTag: row.idTag,
          meterStart: row.meterStart,
          meterEnd: row.meterEnd,
          status: row.status,
          startTimestamp: row.startTimestamp,
          stopTimestamp: row.stopTimestamp,
        };
      });
      logger.info(`Retrieved ${transactions.length} transaction(s).`);
      return transactions;
    } catch (error) {
      logger.error('Error in getTransactions', error);
      throw error;
    }
  }

  async addTransaction(transaction: Transaction): Promise<Transaction> {
    logger.info(`Entering addTransaction for transactionId: ${transaction.transactionId}`);
    try {
      const result = await this.db.run(
        'INSERT INTO transactions (identity, idTag, meterStart, startTimestamp, status) VALUES (?,?,?,?,?)',
        transaction.identity,
        transaction.idTag,
        transaction.meterStart,
        transaction.startTimestamp,
        transaction.status
      );
      const transactionId = result.lastID;
      if (!transactionId) {
        throw new Error('Failed to retrieve transactionId');
      }
      transaction.transactionId = transactionId;
      logger.info(`Transaction added with transactionId: ${transactionId}`);
      return transaction;
    } catch (error) {
      logger.error(`Error in addTransaction for transactionId: ${transaction.transactionId}`, error);
      throw error;
    }
  }

  async updateTransaction(transactionId: string, updates: Partial<Transaction>): Promise<void> {
    logger.info(
      `Entering updateTransaction for transactionId: ${transactionId} with updates: ${JSON.stringify(updates)}`
    );
    try {
      const {meterEnd, status} = updates;
      await this.db.run(
        `
            UPDATE transactions
            SET meterEnd = ?,
                status   = ?
            WHERE transactionId = ?
        `,
        meterEnd,
        status,
        transactionId
      );
      logger.info(`Transaction updated for transactionId: ${transactionId}`);
    } catch (error) {
      logger.error(`Error in updateTransaction for transactionId: ${transactionId}`, error);
      throw error;
    }
  }
}
