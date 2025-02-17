import type {Request, Response} from 'express';
import {TransactionRepository} from '../repository/database';
import logger from '../logger';

export class TransactionController {
  constructor(private transactionRepository: TransactionRepository) {
    logger.info('TransactionController instantiated');
  }

  async getTransactions(req: Request, res: Response) {
    const filters = req.query;
    logger.info({filters}, `Entering getTransactions`);
    try {
      const transactions = await this.transactionRepository.getTransactions(filters);
      res.json({transactions});
    } catch (error) {
      logger.error({filters}, `Error in getTransactions`, error);
      throw error;
    }
  }
}
