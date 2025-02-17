import express from 'express';
import pinoHttp from 'pino-http';
import {RPCServer, createRPCError} from 'ocpp-rpc';
import logger from './logger';
import {initializeFirestoreRepositories, initializeRepositories} from './db';
import {createChargerRouter} from './controller/charger-router';
import config from './config';
import sendRequestToClient from './request';
import {Transaction} from './model/transaction';
import axios from 'axios';
import router from './routes';

(async () => {
  const {chargerRepository, connectedClients, pendingChargingProfiles} =
    await initializeFirestoreRepositories();

  const app = express();
  app.use(pinoHttp({logger}));
  app.use(express.json());
  app.use(createChargerRouter(chargerRepository));
  app.use(router);

  const ocppServer = new RPCServer({
    protocols: ['ocpp1.6'],
    strictMode: true,
  });

  const httpServer = app.listen(config.port, config.host, () => {
    logger.info(`HTTP server listening on http://${config.host}:${config.port}`);
  });

  httpServer.on('upgrade', (req, socket, head) => {
    logger.info(`HTTP upgrade request received from ${req.socket.remoteAddress}`);
    ocppServer.handleUpgrade(req, socket, head);
  });

  ocppServer.on('client', async (client) => {
    const identity = client.identity;
    logger.info(`Client connected with identity: ${identity}`);

    logger.debug(`Looking up charger for identity: ${identity}`);
    const charger = await chargerRepository.getCharger(identity);
    logger.info({charger}, `Entering getCharger with identity: ${identity}`);

    if (!charger) {
      logger.error(`No DB entry found for ${identity}. Closing client.`);
      client.close();
      return;
    }

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
                vendor: params.chargePointVendor,
                model: params.chargePointModel,
                serialNumber: params.chargePointSerialNumber,
                firmwareVersion: params.firmwareVersion,
              },
            };
            logger.debug({payload}, `Sending service creation`);
            const response = await axios.post(
              `https://europe-west1-${charger.projectId}.cloudfunctions.net/connectOcppDevices`,
              payload
            );
            const responseData = response.data;
            logger.debug({responseData}, `[BootNotification] Service creation response for userId ${charger.userId}`);
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
        status: 'Accepted',
        interval: 300,
        currentTime: new Date().toISOString(),
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
        currentTime: heartbeatTimestamp,
      };
      logger.debug({responsePayload}, `Heartbeat response for ${client.identity}`);
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

      if (params.status === 'Charging') {
        logger.info(`Charging status detected for ${client.identity}`);
        const pendingProfile = pendingChargingProfiles.get(client.identity);
        if (pendingProfile?.transactionId) {
          logger.info({pendingProfile}, `Found pending charging profile for ${client.identity}`);
          const {current, duration, transactionId} = pendingProfile;
          const setChargingProfilePayload = {
            connectorId: 1,
            csChargingProfiles: {
              chargingProfileId: 12345,
              stackLevel: 1,
              chargingProfilePurpose: 'TxProfile',
              chargingProfileKind: 'Absolute',
              transactionId: transactionId,
              chargingSchedule: {
                chargingRateUnit: 'A',
                duration: duration,
                chargingSchedulePeriod: [{startPeriod: 0, limit: current}],
              },
            },
          };
          logger.debug({setChargingProfilePayload}, `SetChargingProfile payload for ${client.identity}`);

          try {
            const profileResponse = await sendRequestToClient(
              client.identity,
              'SetChargingProfile',
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
          status: 'Accepted',
        },
      };
    });

    client.handle('StartTransaction', async ({params}) => {
      logger.info({params}, `StartTransaction received from ${client.identity}`);
      const transaction = new Transaction(params.transactionId, client.identity, params.idTag, params.meterStart);
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
          transactionId: transaction.transactionId,
        });
        logger.debug(`Updated pending charging profile with transactionId for ${client.identity}`);
      }
      return {
        transactionId: transaction.transactionId,
        idTagInfo: {status: 'Accepted'},
      };
    });

    client.handle('StopTransaction', async ({params}) => {
      logger.info({params}, `StopTransaction received from ${client.identity}`);
      try {
        await transactionRepository.updateTransaction(params.transactionId, {
          meterEnd: params.meterStop,
          status: 'completed',
        });
        logger.info(`Transaction stopped for ${client.identity}: ${params.transactionId}`);
      } catch (err) {
        logger.error(err, `Failed to update transaction for ${client.identity}`);
        throw err;
      }
      return {
        idTagInfo: {status: 'Accepted'},
      };
    });

    client.handle('DataTransfer', ({params}) => {
      logger.info({params}, `DataTransfer received from ${client.identity}`);
      logger.debug(`DataTransfer vendorId for ${client.identity}: ${params.vendorId}`);
      return {
        status: 'Accepted',
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
      throw createRPCError('NotImplemented');
    });

    client.on('close', () => {
      connectedClients.delete(client.identity);
      logger.info(`Charger disconnected: ${client.identity}`);
    });
  });

  async function updateChargerBootInfo(identity, params) {
    logger.debug({params}, `Updating boot info for ${identity} with params`);
    await chargerRepository.updateCharger(identity, {
      vendor: params.chargePointVendor,
      model: params.chargePointModel,
      serialNumber: params.chargePointSerialNumber,
      firmwareVersion: params.firmwareVersion,
    });
    logger.info(`Charger boot info updated for ${identity}`);
  }

  async function updateChargerStatus(identity, params) {
    logger.debug({params}, `Updating status for ${identity} with params`);
    await chargerRepository.updateCharger(identity, {
      lastStatus: params.status,
      lastStatusTimestamp: params.timestamp,
      errorCode: params.errorCode,
    });
    logger.info(`Charger status updated for ${identity}`);
  }

  async function updateChargerHeartbeat(identity, heartbeatTimestamp) {
    logger.debug({heartbeatTimestamp}, `Updating heartbeat for ${identity}`);
    await chargerRepository.updateCharger(identity, {
      lastHeartbeat: heartbeatTimestamp,
    });
    logger.info(`Charger heartbeat updated for ${identity}`);
  }
})();
