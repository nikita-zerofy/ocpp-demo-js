import express from 'express';
import pinoHttp from 'pino-http';
import {RPCServer, createRPCError} from 'ocpp-rpc';
import logger from './logger';
import {
  connectedClients,
  chargerRepository,
  transactionRepository,
  pendingChargingProfiles
} from './db';
import router from './routes';
import config from './config';
import sendRequestToClient from "./request";
import {Transaction} from "./model/transaction";
import axios from "axios";

const cfg = config();

// NOTE: These are defined in the db module. If you need to reassign them locally, do so here.

async function updateChargerBootInfo(identity, params) {
  logger.debug(`Updating boot info for ${identity} with params: ${JSON.stringify(params)}`);
  await chargerRepository.updateCharger(identity, {
    vendor: params.chargePointVendor,
    model: params.chargePointModel,
    serialNumber: params.chargePointSerialNumber,
    firmwareVersion: params.firmwareVersion
  });
  logger.info(`Charger boot info updated for ${identity}`);
}

async function updateChargerStatus(identity, params) {
  logger.debug(`Updating status for ${identity} with params: ${JSON.stringify(params)}`);
  await chargerRepository.updateCharger(identity, {
    lastStatus: params.status,
    lastStatusTimestamp: params.timestamp,
    errorCode: params.errorCode
  });
  logger.info(`Charger status updated for ${identity}`);
}

async function updateChargerHeartbeat(identity, heartbeatTimestamp) {
  logger.debug(`Updating heartbeat for ${identity} at ${heartbeatTimestamp}`);
  await chargerRepository.updateCharger(identity, {
    lastHeartbeat: heartbeatTimestamp
  });
  logger.info(`Charger heartbeat updated for ${identity}`);
}

const app = express();
app.use(pinoHttp({logger}));
app.use(express.json());
app.use(router);

const ocppServer = new RPCServer({
  protocols: ['ocpp1.6'],
  strictMode: true
});

const httpServer = app.listen(cfg.port, '0.0.0.0', () => {
  logger.info(`HTTP server listening on http://${cfg.host}:${cfg.port}`);
});

httpServer.on('upgrade', (req, socket, head) => {
  logger.info(`HTTP upgrade request received from ${req.socket.remoteAddress}`);
  ocppServer.handleUpgrade(req, socket, head);
});

const failedConnections = new Map(); // Map<identity, { count: number, lastAttempt: number }>
const MAX_FAILED_ATTEMPTS = 3;
const BAN_TIME_MS = 30 * 1000; // Ban for 30 seconds


ocppServer.on('client', async (client) => {
  const identity = client.identity;
  logger.info(`Client connected with identity: ${identity}`);

  // Check if this identity has recent failed attempts.
  const failureRecord = failedConnections.get(identity);
  if (failureRecord) {
    const timeSinceLastAttempt = Date.now() - failureRecord.lastAttempt;
    if (failureRecord.count >= MAX_FAILED_ATTEMPTS && timeSinceLastAttempt < BAN_TIME_MS) {
      logger.warn(`Spamming detected for identity ${identity}. Ignoring connection (ban active).`);
      client.close();
      return;
    } else if (timeSinceLastAttempt >= BAN_TIME_MS) {
      // Ban period expired; reset record.
      failedConnections.delete(identity);
    }
  }

  logger.debug(`Looking up charger for identity: ${identity}`);
  const charger = await chargerRepository.getCharger(identity);
  logger.info(`Entering getCharger with identity: ${identity} charger ${JSON.stringify(charger)}`);

  if (!charger) {
    logger.error(`No DB entry found for ${identity}. Closing client.`);
    // Update the failure record for this identity.
    const now = Date.now();
    if (failedConnections.has(identity)) {
      const record = failedConnections.get(identity);
      record.count++;
      record.lastAttempt = now;
      failedConnections.set(identity, record);
    } else {
      failedConnections.set(identity, {count: 1, lastAttempt: now});
    }
    client.close();
    return;
  }

  // If a valid charger is found, clear any failure record.
  if (failedConnections.has(identity)) {
    failedConnections.delete(identity);
  }

  // Process valid client connection...
  connectedClients.set(identity, client);
  logger.info(`Charger connected: ${identity}`);

  client.handle('BootNotification', async ({params}) => {
    logger.info({params}, `BootNotification received from ${client.identity}`);
    try {
      await updateChargerBootInfo(client.identity, params);
      logger.debug(`Boot info update successful for ${client.identity}`);

      // If this is the first BootNotification, attempt to create the service.
      if (charger.firstBootNotificationReceived == null || charger.firstBootNotificationReceived === 0) {
        logger.info(`First BootNotification for ${client.identity} detected. Initiating service creation.`);
        try {
          const payload = {
            userId: charger.userId,
            dwellingId: charger.dwellingId,
            service: charger.serviceId,
            deviceData: {
              identity: client.identity,
              chargePointVendor: params.chargePointVendor,
              vendor: params.chargePointModel,
              serialNumber: params.chargePointSerialNumber,
              firmwareVersion: params.firmwareVersion
            }
          };
          logger.debug(`Sending service creation payload: ${payload}`);
          const response = await axios.post('http://127.0.0.1:5001/zerofy-energy-dev/europe-west1/connectOcppDevices', payload);
          logger.debug(`[BootNotification] Service creation response for userId ${charger.userId} ${response.data}`, {response: response.data});
          if (response.status === 200) {
            await chargerRepository.updateCharger(client.identity, {firstBootNotificationReceived: true});
            logger.info(`firstBootNotificationReceived flag updated for ${client.identity}`);
          } else {
            logger.warn(`Unexpected response status ${response.status} for service creation on ${client.identity}`);
          }
        } catch (err) {
          logger.error(err, `Failed to create service for ${client.identity}`);
        }
      }
    } catch (err) {
      logger.error(err, `Failed to update charger boot info for ${client.identity}`);
    }
    const responsePayload = {
      status: "Accepted",
      interval: 300,
      currentTime: new Date().toISOString()
    };
    logger.debug(`BootNotification response for ${client.identity}: ${JSON.stringify(responsePayload)}`);
    return responsePayload;
  });

  client.handle('Heartbeat', async ({params}) => {
    logger.info({params}, `Heartbeat received from ${client.identity}`);
    const heartbeatTimestamp = new Date().toISOString();
    try {
      await updateChargerHeartbeat(client.identity, heartbeatTimestamp);
      logger.debug(`Heartbeat update complete for ${client.identity}`);
    } catch (err) {
      logger.error(err, `Failed to update charger heartbeat for ${client.identity}`);
    }
    const responsePayload = {
      currentTime: heartbeatTimestamp
    };
    logger.debug(`Heartbeat response for ${client.identity}: ${JSON.stringify(responsePayload)}`);
    return responsePayload;
  });

  client.handle('StatusNotification', async ({params}) => {
    logger.info({params}, `StatusNotification received from ${client.identity}`);
    try {
      await updateChargerStatus(client.identity, params);
      logger.debug(`Status update complete for ${client.identity}`);
    } catch (err) {
      logger.error(err, `Failed to update charger status for ${client.identity}`);
    }

    if (params.status === "Charging") {
      logger.info(`Charging status detected for ${client.identity}`);
      const pendingProfile = pendingChargingProfiles.get(client.identity);
      if (pendingProfile?.transactionId) {
        logger.info(`Found pending charging profile for ${client.identity}: ${JSON.stringify(pendingProfile)}`);
        const {current, duration, transactionId} = pendingProfile;
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
              chargingSchedulePeriod: [{startPeriod: 0, limit: current}]
            }
          }
        };
        logger.debug(`SetChargingProfile payload for ${client.identity}: ${JSON.stringify(setChargingProfilePayload)}`);

        try {
          const profileResponse = await sendRequestToClient(
            client.identity,
            "SetChargingProfile",
            setChargingProfilePayload
          );
          logger.info({profileResponse}, `Charging profile applied for ${client.identity}`);
        } catch (error) {
          logger.error(error, `Failed to apply charging profile for ${client.identity}`);
        }
        pendingChargingProfiles.delete(client.identity);
        logger.info(`Pending charging profile removed for ${client.identity}`);
      } else {
        logger.debug(`No pending charging profile for ${client.identity}`);
      }
    }
    return {};
  });

  client.handle('Authorize', ({params}) => {
    logger.info({params}, `Authorize received from ${client.identity}`);
    return {
      idTagInfo: {
        status: "Accepted"
      }
    };
  });

  client.handle('StartTransaction', async ({params}) => {
    logger.info({params}, `StartTransaction received from ${client.identity}`);
    const transaction = new Transaction(
      params.transactionId,
      client.identity,
      params.idTag,
      params.meterStart
    );
    try {
      await transactionRepository.addTransaction(transaction);
      logger.info(`Transaction started for ${client.identity}: ${transaction.transactionId}`);
    } catch (err) {
      logger.error(err, `Failed to add transaction for ${client.identity}`);
      throw err;
    }
    const pendingProfile = pendingChargingProfiles.get(client.identity);
    if (pendingProfile) {
      pendingChargingProfiles.set(client.identity, {
        ...pendingProfile,
        transactionId: transaction.transactionId
      });
      logger.debug(`Updated pending charging profile with transactionId for ${client.identity}`);
    }
    return {
      transactionId: transaction.transactionId,
      idTagInfo: {status: "Accepted"}
    };
  });

  client.handle('StopTransaction', async ({params}) => {
    logger.info({params}, `StopTransaction received from ${client.identity}`);
    try {
      await transactionRepository.updateTransaction(params.transactionId, {
        meterEnd: params.meterStop,
        status: 'completed'
      });
      logger.info(`Transaction stopped for ${client.identity}: ${params.transactionId}`);
    } catch (err) {
      logger.error(err, `Failed to update transaction for ${client.identity}`);
      throw err;
    }
    return {
      idTagInfo: {status: "Accepted"}
    };
  });

  client.handle('DataTransfer', ({params}) => {
    logger.info({params}, `DataTransfer received from ${client.identity}`);
    logger.debug(`DataTransfer vendorId for ${client.identity}: ${params.vendorId}`);
    return {
      status: "Accepted"
    };
  });

  client.handle('MeterValues', ({params}) => {
    logger.info({params}, `MeterValues received from ${client.identity}`);
    // Optionally add more logging here if meter values need further processing.
    return {};
  });

  client.handle('DiagnosticsStatusNotification', ({params}) => {
    logger.info({params}, `DiagnosticsStatusNotification received from ${client.identity}`);
    return {};
  });

  client.handle('FirmwareStatusNotification', ({params}) => {
    logger.info({params}, `FirmwareStatusNotification received from ${client.identity}`);
    return {};
  });

  // Fallback for unrecognized methods
  client.handle(({method, params}) => {
    logger.warn({method, params}, `Unrecognized method received from ${client.identity}`);
    throw createRPCError("NotImplemented");
  });

  client.on('close', () => {
    connectedClients.delete(client.identity);
    logger.info(`Charger disconnected: ${client.identity}`);
  });
});
