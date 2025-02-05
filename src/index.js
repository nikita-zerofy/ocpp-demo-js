import express from 'express';
import pinoHttp from 'pino-http';
import { RPCServer, createRPCError } from 'ocpp-rpc';
import logger from './logger.js';
import { connectedClients, dbPromise, pendingChargingProfiles } from './db.js';
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

/**
 * Update charger boot info based on BootNotification parameters.
 * @param {string} chargerId
 * @param {object} params - BootNotification parameters
 */
async function updateChargerBootInfo(chargerId, params) {
  const db = await dbPromise;
  await db.run(`
    UPDATE chargers
    SET vendor = ?,
        model = ?,
        serialNumber = ?,
        firmwareVersion = ?
    WHERE chargerId = ?
  `, [
    params.chargePointVendor,
    params.chargePointModel,
    params.chargePointSerialNumber,
    params.firmwareVersion,
    chargerId
  ]);
}

/**
 * Update charger status based on StatusNotification parameters.
 * @param {string} chargerId
 * @param {object} params - StatusNotification parameters
 */
async function updateChargerStatus(chargerId, params) {
  const db = await dbPromise;
  await db.run(`
    UPDATE chargers
    SET lastStatus = ?,
        lastStatusTimestamp = ?,
        errorCode = ?
    WHERE chargerId = ?
  `, [
    params.status,
    params.timestamp,
    params.errorCode,
    chargerId
  ]);
}

/**
 * Update the last heartbeat timestamp for a charger.
 * @param {string} chargerId
 * @param {string} heartbeatTimestamp - ISO formatted timestamp
 */
async function updateChargerHeartbeat(chargerId, heartbeatTimestamp) {
  const db = await dbPromise;
  await db.run(`
    UPDATE chargers
    SET lastHeartbeat = ?
    WHERE chargerId = ?
  `, [heartbeatTimestamp, chargerId]);
}

ocppServer.on('client', async (client) => {
  logger.info(`Client connected with identity: ${client.identity}`);
  const chargerId = client.identity;
  const db = await dbPromise;

  // Check if a charger record exists. If not, log error and close connection.
  const row = await db.get(`SELECT * FROM chargers WHERE chargerId = ?`, chargerId);
  if (!row) {
    logger.error(`No DB entry found for ${chargerId}. Closing client.`);
    client.close();
    return;
  }

  connectedClients.set(client.identity, client);
  logger.info(`Charger connected: ${client.identity}`);

  client.handle('BootNotification', async ({ params }) => {
    logger.info({ params }, `BootNotification from ${client.identity}`);
    try {
      // Update the charger record with boot details
      await updateChargerBootInfo(client.identity, params);
    } catch (err) {
      logger.error(err, 'Failed to update charger boot info');
    }
    return {
      status: "Accepted",
      interval: 300,
      currentTime: new Date().toISOString()
    };
  });

  client.handle('Heartbeat', async ({params}) => {
    logger.info({params}, `Heartbeat from ${client.identity}`);
    const heartbeatTimestamp = new Date().toISOString();
    try {
      await updateChargerHeartbeat(client.identity, heartbeatTimestamp);
    } catch (err) {
      logger.error(err, 'Failed to update charger boot info');
    }
    return {
      currentTime: heartbeatTimestamp
    };
  });

  client.handle('StatusNotification', async ({ params }) => {
    logger.info({ params }, `StatusNotification from ${client.identity}`);
    try {
      // Update the charger record with the latest status information
      await updateChargerStatus(client.identity, params);
    } catch (err) {
      logger.error(err, 'Failed to update charger status');
    }

    // If the charger is charging and a pending profile exists, apply it.
    if (params.status === "Charging") {
      const pendingProfile = pendingChargingProfiles.get(client.identity);
      if (pendingProfile?.transactionId) {
        const { current, duration, transactionId } = pendingProfile;
        const setChargingProfilePayload = {
          connectorId: 1,
          csChargingProfiles: {
            chargingProfileId: 12345,
            stackLevel: 1,
            chargingProfilePurpose: "TxProfile",
            chargingProfileKind: "Absolute",
            transactionId: transactionId, // Use the actual transactionId
            chargingSchedule: {
              chargingRateUnit: "A",
              duration: duration,
              chargingSchedulePeriod: [{ startPeriod: 0, limit: current }]
            }
          }
        };

        try {
          const profileResponse = await sendRequestToClient(
            client.identity,
            "SetChargingProfile",
            setChargingProfilePayload
          );
          logger.info({ profileResponse }, 'Charging profile applied');
        } catch (error) {
          logger.error(error, 'Failed to apply charging profile');
        }

        pendingChargingProfiles.delete(client.identity);
      }
    }
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

  client.handle('StartTransaction', async ({ params }) => {
    const db = await dbPromise;
    const { lastID: transactionId } = await db.run(`
      INSERT INTO transactions (chargerId, idTag, meterStart)
      VALUES (?, ?, ?)
    `, [client.identity, params.idTag, params.meterStart]);
    logger.info({ transactionId }, 'Transaction started');
    const pendingProfile = pendingChargingProfiles.get(client.identity);
    if (pendingProfile) {
      pendingChargingProfiles.set(client.identity, {
        ...pendingProfile,
        transactionId // Link to the actual transactionId
      });
    }
    return {
      transactionId,
      idTagInfo: { status: "Accepted" }
    };
  });

  client.handle('StopTransaction', async ({ params }) => {
    const db = await dbPromise;
    await db.run(`
      UPDATE transactions
      SET stopTimestamp = CURRENT_TIMESTAMP,
          meterEnd = ?,
          status = 'completed'
      WHERE transactionId = ?
    `, [params.meterStop, params.transactionId]);
    logger.info({ transactionId: params.transactionId }, 'Transaction stopped');
    return {
      idTagInfo: { status: "Accepted" }
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
    };
  });

  client.handle('MeterValues', ({ params }) => {
    logger.info({ params }, `MeterValues from ${client.identity}`);
    return {};
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
