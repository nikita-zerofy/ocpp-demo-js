import express from 'express';
import type {Request, Response} from 'express';
import type {TransactionRepository} from '../repository/database';
import {TransactionController} from './transaction-controller';

export function createTransactionRouter(transactionRepository: TransactionRepository) {
  const router = express.Router();
  const transactionController = new TransactionController(transactionRepository);

  router.get('/transactions', async (req: Request, res: Response) => {
    await transactionController.getTransactions(req, res);
  });

  return router;
}
