import express from 'express';
import logger from './logger';
import {connectedClients} from './db';

const routes = express.Router();

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
