import express from 'express';
import pinoHttp from 'pino-http';
import {RPCServer, createRPCError, RPCClient} from 'ocpp-rpc';
import {Socket} from 'node:net';
import {Transaction} from './model/transaction';
import {initializeSQLiteRepositories} from './db';
import {createChargerRouter} from './controller/charger-router';
import {createTransactionRouter} from './controller/transaction-router';
import sendRequestToClient from './request';
import config from './config';
import logger from './logger';
import axios from 'axios';
import router from './routes';

(async () => {
  const {chargerRepository, transactionRepository, connectedClients, pendingChargingProfiles} =
    await initializeSQLiteRepositories();

  const app = express();
  app.use(
    pinoHttp({
      logger,
      autoLogging: {
        ignore: (req) => req.url === '/health',
      },
    })
  );
  app.use(express.json());
  app.use(createChargerRouter(chargerRepository, transactionRepository));
  app.use(createTransactionRouter(transactionRepository));
  app.use(router);

  const ocppServer = new RPCServer({
    protocols: ['ocpp1.6'],
    strictMode: true,
  });

  const httpServer = app.listen(config.port, '0.0.0.0', () => {
    logger.info(`HTTP server listening on https://${config.host}:${config.port}`);
  });

  const connectionAttempts = new Map<string, number>();

  httpServer.on('upgrade', (req, socket, head) => {
    logger.info(`HTTP upgrade request received from ${req.socket.remoteAddress}`);
    ocppServer.handleUpgrade(req, socket as Socket, head);
  });

  ocppServer.on('client', async (client: RPCClient) => {
    const identity = client.identity;
    if (!identity) {
      logger.error('Client connected without identity. Closing client.');
      await client.close();
      return;
    }

    const attempts = connectionAttempts.get(identity) || 0;
    if (attempts > 3) {
      await client.close();
      return;
    }
    connectionAttempts.set(identity, attempts + 1);

    logger.info(`Client connected with identity: ${identity}`);

    logger.debug(`Looking up charger for identity: ${identity}`);
    const charger = await chargerRepository.getCharger(identity);
    logger.info({charger}, `Entering getCharger with identity: ${identity}`);

    if (!charger) {
      logger.error(`No DB entry found for ${identity}. Closing client.`);
      await client.close();
      return;
    }

    connectedClients.set(identity, client);
    logger.info(`Charger connected: ${identity}`);

    client.handle('BootNotification', async ({params}: any) => {
      if (!params) {
        logger.error(`Invalid BootNotification received from ${identity}. Missing params.`);
        throw createRPCError('FormError', 'Missing params');
      }
      logger.info({params}, `BootNotification received from ${identity}`);
      try {
        await updateChargerBootInfo(identity, params);
        logger.debug(`Boot info update successful for ${identity}`);

        // @ts-ignore
        if (charger.firstBootNotificationReceived == null || charger.firstBootNotificationReceived === 0) {
          logger.info(`First BootNotification for ${identity} detected. Initiating service creation.`);
          try {
            const payload = {
              userId: charger.userId,
              dwellingId: charger.dwellingId,
              service: charger.serviceId,
              deviceData: {
                identity: identity,
                vendor: params.chargePointVendor,
                model: params.chargePointModel,
                serialNumber: params.chargePointSerialNumber,
                firmwareVersion: params.firmwareVersion,
              },
            };
            logger.debug({payload}, `Sending service creation`);
            const url = (): string =>
              config.nodeEnv === 'production'
                ? `https://europe-west1-${charger.projectId}.cloudfunctions.net/connectOcppDevices`
                : `http://127.0.0.1:5001/zerofy-energy-dev/europe-west1/connectOcppDevices`;
            const response = await axios.post(url(), payload);
            const responseData = response.data;
            logger.debug({responseData}, `[BootNotification] Service creation response for userId ${charger.userId}`);
            if (response.status === 200) {
              await chargerRepository.updateCharger(identity, {firstBootNotificationReceived: true});
              logger.info(`firstBootNotificationReceived flag updated for ${identity}`);
            } else {
              logger.warn(`Unexpected response status ${response.status} for service creation on ${identity}`);
            }
          } catch (err) {
            logger.error(err, `Failed to create service for ${identity}`);
          }
        }
      } catch (err) {
        logger.error(err, `Failed to update charger boot info for ${identity}`);
      }
      const responsePayload = {
        status: 'Accepted',
        interval: 300,
        currentTime: new Date().toISOString(),
      };
      logger.debug(`BootNotification response for ${identity}: ${JSON.stringify(responsePayload)}`);
      return responsePayload;
    });

    client.handle('Heartbeat', async ({params}) => {
      logger.info({params}, `Heartbeat received from ${client.identity}`);
      const heartbeatTimestamp = new Date().toISOString();
      try {
        await updateChargerHeartbeat(identity, heartbeatTimestamp);
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

    client.handle('StatusNotification', async ({params}: any) => {
      logger.info({params}, `StatusNotification received from ${client.identity}`);
      try {
        await updateChargerStatus(identity, params);
        logger.debug(`Status update complete for ${client.identity}`);
      } catch (err) {
        logger.error(err, `Failed to update charger status for ${client.identity}`);
      }
      return {};
    });

    client.handle('Authorize', async ({params}: any) => {
      logger.info({params}, `Authorize received from ${client.identity}`);
      return {
        idTagInfo: {
          status: 'Accepted',
        },
      };
    });

    client.handle('StartTransaction', async ({params}: any) => {
      logger.info({params}, `StartTransaction received from ${client.identity}`);

      const transaction: Transaction = {
        transactionId: null, // Will be set by the repository
        identity: client.identity!,
        idTag: params.idTag,
        meterStart: params.meterStart,
        meterEnd: null,
        status: 'active',
        startTimestamp: new Date().toISOString(),
        stopTimestamp: null,
      };

      try {
        const addedTransaction = await transactionRepository.addTransaction(transaction);
        logger.info(`Transaction started for ${client.identity}: ${addedTransaction.transactionId}`);

        const pendingProfile = pendingChargingProfiles.get(client.identity!);
        const responsePayload = {
          transactionId: addedTransaction.transactionId,
          idTagInfo: {status: 'Accepted'},
        };

        // After sending response, asynchronously send the SetChargingProfile command
        if (pendingProfile && !pendingProfile.transactionId) {
          pendingProfile.transactionId = addedTransaction.transactionId;
          setTimeout(async () => {
            const setChargingProfilePayload = {
              connectorId: 1,
              csChargingProfiles: {
                chargingProfileId: 12345,
                stackLevel: 1,
                chargingProfilePurpose: 'TxProfile',
                chargingProfileKind: 'Absolute',
                transactionId: addedTransaction.transactionId,
                chargingSchedule: {
                  chargingRateUnit: 'A',
                  chargingSchedulePeriod: [{startPeriod: 0, limit: pendingProfile.current}],
                },
              },
            };
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
            pendingChargingProfiles.delete(client.identity!);
          }, 1000);
        }

        return responsePayload;
      } catch (err) {
        logger.error(err, `Failed to add transaction for ${client.identity}`);
        return {
          transactionId: null,
          idTagInfo: {status: 'Rejected'},
        };
      }
    });

    client.handle('StopTransaction', async ({params}: any) => {
      logger.info({params}, `StopTransaction received from ${client.identity}`);
      try {
        await transactionRepository.updateTransaction(params.transactionId, {
          meterEnd: params.meterStop,
          status: 'completed',
        });
        logger.info(`Transaction stopped for ${client.identity}: ${params.transactionId}`);
        await chargerRepository.updateCharger(identity, {
          power: 0,
        });
      } catch (err) {
        logger.error(err, `Failed to update transaction for ${client.identity}`);
        throw err;
      }
      return {
        idTagInfo: {status: 'Accepted'},
      };
    });

    client.handle('DataTransfer', async ({params}: any) => {
      logger.info({params}, `DataTransfer received from ${client.identity}`);
      logger.debug(`DataTransfer vendorId for ${client.identity}: ${params.vendorId}`);
      return {
        status: 'Accepted',
      };
    });

    interface SampledValue {
      value: string;
      context: string;
      format: string;
      measurand: string;
      location?: string;
      unit: string;
      phase?: string;
    }

    interface MeterValue {
      timestamp: string;
      sampledValue: SampledValue[];
    }

    interface MeterValuesParams {
      connectorId: number;
      transactionId: number;
      meterValue: MeterValue[];
    }

    client.handle('MeterValues', async ({params}: any) => {
      logger.info({params}, `MeterValues received from ${identity}`);
      const param = params as MeterValuesParams;
      const totalPowerMeterValue = param.meterValue.find((meterValue: MeterValue) => {
        return meterValue.sampledValue.some((sampledValue: SampledValue) => {
          return sampledValue.measurand === 'Power.Active.Import' && !sampledValue.phase;
        });
      });

      if (totalPowerMeterValue) {
        const totalPowerSampledValue = totalPowerMeterValue.sampledValue.find(
          (sampledValue: SampledValue) => sampledValue.measurand === 'Power.Active.Import' && !sampledValue.phase
        );
        if (totalPowerSampledValue) {
          const totalPowerInKillowatts = parseFloat(totalPowerSampledValue.value) / 1000;
          await chargerRepository.updateCharger(identity, {
            power: totalPowerInKillowatts,
          });
        } else {
          logger.warn('Total power sampled value not found in MeterValues');
        }
      } else {
        logger.warn('Total power meter value not found in MeterValues');
      }

      return {};
    });

    client.handle('DiagnosticsStatusNotification', async ({params}) => {
      logger.info({params}, `DiagnosticsStatusNotification received from ${client.identity}`);
      return {};
    });

    client.handle('FirmwareStatusNotification', async ({params}) => {
      logger.info({params}, `FirmwareStatusNotification received from ${client.identity}`);
      return {};
    });

    client.handle(({method, params}) => {
      logger.warn({method, params}, `Unrecognized method received from ${client.identity}`);
      throw createRPCError('NotImplemented');
    });

    client.on('close', () => {
      connectedClients.delete(identity);
      logger.info(`Charger disconnected: ${client.identity}`);
    });
  });

  async function updateChargerBootInfo(identity: string, params: any) {
    logger.debug({params}, `Updating boot info for ${identity} with params`);
    await chargerRepository.updateCharger(identity, {
      vendor: params.chargePointVendor,
      model: params.chargePointModel,
      serialNumber: params.chargePointSerialNumber,
      firmwareVersion: params.firmwareVersion,
    });
    logger.info(`Charger boot info updated for ${identity}`);
  }

  async function updateChargerStatus(identity: string, params: any) {
    logger.debug({params}, `Updating status for ${identity} with params`);
    await chargerRepository.updateCharger(identity, {
      lastStatus: params.status,
      lastStatusTimestamp: params.timestamp,
      errorCode: params.errorCode,
    });
    logger.info(`Charger status updated for ${identity}`);
  }

  async function updateChargerHeartbeat(identity: string, heartbeatTimestamp: string) {
    logger.debug({heartbeatTimestamp}, `Updating heartbeat for ${identity}`);
    await chargerRepository.updateCharger(identity, {
      lastHeartbeat: heartbeatTimestamp,
    });
    logger.info(`Charger heartbeat updated for ${identity}`);
  }
})();
