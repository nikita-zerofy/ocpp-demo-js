import express from 'express';
import pinoHttp from 'pino-http';
import { RPCServer, createRPCError } from 'ocpp-rpc';
import logger from './logger';
import { connectedClients, createChargerRepository, createTransactionRepository, dbPromise, pendingChargingProfiles } from './db';
import router from './routes';
import config from './config';
import sendRequestToClient from "./request";
import axios from "axios";
import { Transaction } from "./model/transaction";

const cfg = config();

let chargerRepository, transactionsRepository;

// Refactored update functions using the repository.
async function updateChargerBootInfo(chargerId, params) {
  // Assuming the repository has an updateCharger method.
  await chargerRepository.updateCharger(chargerId, {
    vendor: params.chargePointVendor,
    model: params.chargePointModel,
    serialNumber: params.chargePointSerialNumber,
    firmwareVersion: params.firmwareVersion
  });
}

async function updateChargerStatus(chargerId, params) {
  await chargerRepository.updateCharger(chargerId, {
    lastStatus: params.status,
    lastStatusTimestamp: params.timestamp,
    errorCode: params.errorCode
  });
}

async function updateChargerHeartbeat(chargerId, heartbeatTimestamp) {
  await chargerRepository.updateCharger(chargerId, {
    lastHeartbeat: heartbeatTimestamp
  });
}

// Wrap the entire server initialization in an async IIFE to avoid top-level await.
(async () => {
  // Create repositories first.
  chargerRepository = await createChargerRepository();
  transactionsRepository = await createTransactionRepository();

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

    // Check if a charger record exists using the repository.
    const charger = await chargerRepository.getCharger(chargerId);
    if (!charger) {
      logger.error(`No DB entry found for ${chargerId}. Closing client.`);
      client.close();
      return;
    }

    connectedClients.set(client.identity, client);
    logger.info(`Charger connected: ${client.identity}`);

    client.handle('BootNotification', async ({ params }) => {
      logger.info({ params }, `BootNotification from ${client.identity}`);
      try {
        await updateChargerBootInfo(client.identity, params);

        // If this is the first BootNotification, attempt to create the service.
        if (!charger.firstBootNotificationReceived) {
          try {
            const response = await axios.post('http://127.0.0.1:5001/zerofy-energy-dev/europe-west1/createOcppService', {
              chargerId: client.identity,
              vendor: params.chargePointVendor,
              model: params.chargePointModel,
              serialNumber: params.chargePointSerialNumber,
              firmwareVersion: params.firmwareVersion,
              userID: charger.userId,
              dwellingID: charger.dwellingId,
              serviceID: charger.serviceId
            });
            logger.debug(`[BootNotification] create service response for userId ${charger.userId}`, response.data);
            if (response.status === 200) {
              await chargerRepository.updateCharger(client.identity, { firstBootNotificationReceived: true });
            }
          } catch (err) {
            logger.error(err, 'Failed to update charger boot info');
          }
        }
      } catch (err) {
        logger.error(err, 'Failed to update charger boot info');
      }
      return {
        status: "Accepted",
        interval: 300,
        currentTime: new Date().toISOString()
      };
    });

    client.handle('Heartbeat', async ({ params }) => {
      logger.info({ params }, `Heartbeat from ${client.identity}`);
      const heartbeatTimestamp = new Date().toISOString();
      try {
        await updateChargerHeartbeat(client.identity, heartbeatTimestamp);
      } catch (err) {
        logger.error(err, 'Failed to update charger heartbeat');
      }
      return {
        currentTime: heartbeatTimestamp
      };
    });

    client.handle('StatusNotification', async ({ params }) => {
      logger.info({ params }, `StatusNotification from ${client.identity}`);
      try {
        await updateChargerStatus(client.identity, params);
      } catch (err) {
        logger.error(err, 'Failed to update charger status');
      }

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
              transactionId: transactionId,
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
      const transaction = new Transaction(
        params.transactionId,
        client.identity,
        params.idTag,
        params.meterStart
      );
      await transactionsRepository.addTransaction(transaction);
      logger.info(`Transaction started ${client.identity} ${transaction.transactionId}`);
      const pendingProfile = pendingChargingProfiles.get(client.identity);
      if (pendingProfile) {
        pendingChargingProfiles.set(client.identity, {
          ...pendingProfile,
          transactionId: transaction.transactionId
        });
      }
      return {
        transactionId: transaction.transactionId,
        idTagInfo: { status: "Accepted" }
      };
    });

    client.handle('StopTransaction', async ({ params }) => {
      await transactionsRepository.updateTransaction(params.transactionId, {
        meterEnd: params.meterStop,
        status: 'completed'
      });
      logger.info(`Transaction stopped ${client.identity} ${params.transactionId}`);
      return {
        idTagInfo: { status: "Accepted" }
      };
    });

    client.handle('DataTransfer', ({ params }) => {
      logger.info({ params }, `DataTransfer from ${client.identity}`);
      logger.info(`vendorId ${params.vendorId}`, params.vendorId);
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

  // Start the HTTP server (if not already started above)
  // (Your app.listen is already in the IIFE above)
})();
