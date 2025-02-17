import express from 'express';
import logger from './logger';
import {connectedClients} from './db';

const routes = express.Router();

// /** GET /transactions
//  *  Retrieve transactions with optional filtering by identity and status.
//  */
// routes.get('/transactions', async (req, res) => {
//   logger.info('[/transactions] Received request for transactions.', {query: req.query});
//   try {
//     const {identity, status} = req.query;
//     const transactions = await transactionRepository.getTransactions({identity: identity, status});
//     logger.info(`[/transactions] Retrieved ${transactions.length} transaction(s).`);
//     res.json({transactions});
//   } catch (error) {
//     logger.error(error, '[/transactions] Failed to retrieve transactions.');
//     res.status(500).json({error: error.message});
//   }
// });

/** GET /connected
 *  List the currently connected charger identities.
 */
routes.get('/connected', (req, res) => {
  logger.info('[/connected] Received request for connected clients.');
  const clients = Array.from(connectedClients.keys());
  logger.info('[/connected] Connected clients retrieved.', {count: clients.length, clients});
  res.json({connectedClients: clients});
});

export default routes;
