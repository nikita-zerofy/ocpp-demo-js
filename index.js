import express from 'express';
import pinoHttp from 'pino-http';
import { RPCServer, createRPCError } from 'ocpp-rpc';
import logger from './logger.js';
import {connectedClients, dbPromise, initDB} from './db.js';
import router from './routes.js';
import config from './config.js';
import sendRequestToClient from "./request.js";
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

    // Here, generate or retrieve your transactionId
    // For testing purposes, we use a static id
    const transactionId = 123;

    return {
      transactionId,
      idTagInfo: {
        status: "Accepted"
      }
    };
  });

  client.handle('DataTransfer', ({params}) => {
    /*
    If a Charge Point needs to send information to the Central System for a function not supported by
    OCPP, it SHALL use the DataTransfer.req PDU.
    The vendorId in the request SHOULD be known to the Central System and uniquely identify the
    vendor-specific implementation. The VendorId SHOULD be a value from the reversed DNS namespace,
    where the top tiers of the name, when reversed, should correspond to the publicly registered primary
    DNS name of the Vendor organisation.
    Optionally, the messageId in the request PDU MAY be used to indicate a specific message or
    implementation.
    The length of data in both the request and response PDU is undefined and should be agreed upon by all
    parties involved.
    If the recipient of the request has no implementation for the specific vendorId it SHALL return a status
    ‘UnknownVendor’ and the data element SHALL not be present. In case of a messageId mismatch (if
    used) the recipient SHALL return status ‘UnknownMessageId’. In all other cases the usage of status
    ‘Accepted’ or ‘Rejected’ and the data element is part of the vendor-specific agreement between the
    parties involved.
     */
    logger.info({params}, `DataTransfer from ${client.identity}`);
    logger.info(`vendorId ${params.vendorId}`, params.vendorId); // save it
    return {
      status: "Accepted"
      // data: "some optional response"
    };
  });

  client.handle('MeterValues', ({ params }) => {
    logger.info({ params }, `MeterValues from ${client.identity}`);
    return {};  // or just omit; returning {} is typical
  });

  client.handle('StopTransaction', ({ params }) => {
    logger.info({ params }, `StopTransaction from ${client.identity}`);
    return {
      idTagInfo: {
        status: "Accepted"
      }
    };
  });

  client.handle('DiagnosticsStatusNotification', ({ params }) => {
    logger.info({ params }, `DiagnosticsStatusNotification from ${client.identity}`);
    return {};
  });

  client.handle('FirmwareStatusNotification', ({ params }) => {
    logger.info({ params }, `FirmwareStatusNotification from ${client.identity}`);
    return {};
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
