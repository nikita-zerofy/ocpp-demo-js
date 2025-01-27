import express from 'express';
import pinoHttp from 'pino-http';
import { RPCServer, createRPCError } from 'ocpp-rpc';
import logger from './logger.js';
import {connectedClients, dbPromise, initDB} from './db.js';
import router from './routes.js';
import config from './config.js';
const cfg = config();

const app = express();

app.use(pinoHttp({ logger }));
app.use(express.json());
app.use(router);

const ocppServer = new RPCServer({
  protocols: ['ocpp1.6'],
  strictMode: true
});

const httpServer = app.listen(cfg.port, '0.0.0.0', () => {
  logger.info(`HTTP server listening on http://${cfg.host}:${cfg.port}`);
});

httpServer.on('upgrade', ocppServer.handleUpgrade);

ocppServer.on('client', async (client) => {
  logger.info(`Client connected with identity: ${client.identity}`);
  const chargerId = client.identity;

  const db = await dbPromise;
  const row = await db.get(`
    SELECT * FROM chargers WHERE chargerId = ?
  `, chargerId);

  if (!row) {
    logger.error(`No DB entry found for ${chargerId}. Closing client.`);
    client.close();
    return;
  }

  connectedClients.set(client.identity, client);
  logger.info(`Charger connected: ${client.identity}`);

  client.handle('BootNotification', ({ params }) => {
    logger.info({ params }, `BootNotification from ${client.identity}`);
    return {
      status: "Accepted",
      interval: 300,
      currentTime: new Date().toISOString()
    };
  });

  client.handle('Heartbeat', ({ params }) => {
    logger.info({ params }, `Heartbeat from ${client.identity}`);
    return {
      currentTime: new Date().toISOString()
    };
  });

  client.handle('StatusNotification', ({ params }) => {
    logger.info({ params }, `StatusNotification from ${client.identity}`);
    return {};
  });

  client.handle('Authorize', ({ params }) => {
    logger.info({ params }, `Authorize from ${client.identity}`);
    return {
      idTagInfo: {
        status: "Accepted"
      }
    };
  });

  client.handle('StartTransaction', ({ params }) => {
    logger.info({ params }, `StartTransaction from ${client.identity}`);
    return {
      transactionId: 123,
      idTagInfo: {
        status: "Accepted"
      }
    };
  });

  client.handle(({ method, params }) => {
    logger.warn({ method, params }, `Unrecognized method from ${client.identity}`);
    throw createRPCError("NotImplemented");
  });

  client.on('close', () => {
    connectedClients.delete(client.identity);
    logger.info(`Charger disconnected: ${client.identity}`);
  });
});

initDB().catch(err => {
  logger.error(err, 'Failed to init DB');
  process.exit(1);
});
