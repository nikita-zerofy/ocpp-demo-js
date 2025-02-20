import type {Request, Response} from 'express';
import {ChargerRepository, TransactionRepository} from '../repository/database';
import {Charger} from '../model/charger';
import logger from '../logger';
import {randomUUID} from 'node:crypto';
import config from '../config';
import sendRequestToClient from '../request';
import {pendingChargingProfiles} from '../db';

export class ChargerController {
  constructor(
    private chargerRepository: ChargerRepository,
    private transactionRepository: TransactionRepository
  ) {
    logger.info('ChargerController instantiated');
  }

  async createCharger(req: Request, res: Response): Promise<Response> {
    logger.info('ChargerController: Received createCharger request', {requestBody: req.body});
    const {userId, dwellingId, serviceId, projectId} = req.body;
    if (!userId || !dwellingId || !serviceId || !projectId) {
      logger.warn('ChargerController: Missing required fields', {userId, dwellingId, serviceId, projectId});
      return res.status(400).json({error: 'Missing userId, dwellingId, serviceId or projectId'});
    }
    try {
      const charger = new Charger(randomUUID().toUpperCase(), userId, dwellingId, serviceId, projectId);
      logger.debug('ChargerController: New charger created', {charger});
      await this.chargerRepository.addCharger(charger);
      logger.info('ChargerController: Charger added to repository', {identity: charger.id});
      return res.json({ocppUrl: `ws://${config.host}:${config.port}`, identity: charger.id});
    } catch (err: any) {
      logger.error(err, 'ChargerController: Failed to create charger');
      return res.status(400).json({error: err.message});
    }
  }

  async getAllChargers(_req: Request, res: Response): Promise<Response> {
    logger.info('ChargerController: Received getAllChargers request');
    try {
      const chargers = await this.chargerRepository.getAllChargers();
      logger.info('ChargerController: Retrieved chargers from repository', {count: chargers.length});
      return res.json({chargers});
    } catch (error: any) {
      logger.error(error, 'ChargerController: Failed to retrieve chargers');
      return res.status(500).json({error: error.message});
    }
  }

  async getCharger(req: Request, res: Response): Promise<Response> {
    const {identity} = req.params;
    logger.info(`ChargerController: Received getCharger request for identity ${identity}`);
    try {
      if (!identity) {
        logger.warn('ChargerController: Missing identity');
        return res.status(400).json({error: 'Missing identity'});
      }
      await sendRequestToClient(identity, 'TriggerMessage', {
        requestedMessage: 'Heartbeat',
        connectorId: 1,
      });
      await sendRequestToClient(identity, 'TriggerMessage', {
        requestedMessage: 'StatusNotification',
        connectorId: 1,
      });
      const charger = await this.chargerRepository.getCharger(identity);
      if (!charger) {
        logger.warn(`ChargerController: Charger not found for identity ${identity}`);
        return res.status(404).json({error: 'Charger not found'});
      }
      logger.info(`ChargerController: Charger retrieved`, {charger});
      return res.json(charger);
    } catch (error: any) {
      logger.error(error, `ChargerController: Failed to retrieve charger for identity ${identity}`);
      return res.status(500).json({error: error.message});
    }
  }

  async updateCharger(req: Request, res: Response): Promise<Response> {
    const {identity} = req.params;
    logger.info(`ChargerController: Received updateCharger request for identity ${identity}`, {requestBody: req.body});
    try {
      if (!identity) {
        logger.warn('ChargerController: Missing identity');
        return res.status(400).json({error: 'Missing identity'});
      }
      await this.chargerRepository.updateCharger(identity, req.body);
      const updatedCharger = await this.chargerRepository.getCharger(identity);
      logger.info(`ChargerController: Charger updated successfully for identity ${identity}`, {updatedCharger});
      return res.json({message: 'Charger updated successfully', charger: updatedCharger});
    } catch (error: any) {
      logger.error(error, `ChargerController: Error updating charger for identity ${identity}`);
      return res.status(500).json({error: error.message});
    }
  }

  async deleteCharger(req: Request, res: Response): Promise<Response> {
    const {identity} = req.params;
    logger.info(`ChargerController: Received deleteCharger request for identity ${identity}`);
    try {
      if (!identity) {
        logger.warn('ChargerController: Missing identity');
        return res.status(400).json({error: 'Missing identity'});
      }
      await this.chargerRepository.deleteCharger(identity);
      logger.info(`ChargerController: Charger deleted successfully for identity ${identity}`);
      return res.json({message: 'Charger deleted successfully'});
    } catch (error: any) {
      logger.error(error, `ChargerController: Error deleting charger for identity ${identity}`);
      return res.status(500).json({error: error.message});
    }
  }

  async startCharging(req: Request, res: Response): Promise<Response> {
    const {identity} = req.params;
    if (!identity) {
      logger.warn('ChargerController: Missing identity');
      return res.status(400).json({error: 'Missing identity'});
    }
    logger.info(`ChargerController: Received startCharging request for client ${identity}`, {requestBody: req.body});

    const {current} = req.body;
    if (!current) {
      logger.warn(`ChargerController: Missing current or duration in request for client ${identity}`);
      return res.status(400).json({error: 'current/duration is required'});
    }

    try {
      logger.debug(`ChargerController: Sending RemoteStartTransaction request for client ${identity}`);
      const response = await sendRequestToClient(identity, 'RemoteStartTransaction', {
        idTag: 'myIdTag123',
        connectorId: 1,
      });
      pendingChargingProfiles.set(identity, {
        current,
        transactionId: null,
      });
      logger.info(`ChargerController: Charging started for client ${identity}, profile pending application.`);
      return res.json({
        message: 'Charging started. Profile will be applied once active.',
        details: response,
      });
    } catch (error: any) {
      logger.error(error, `ChargerController: Error starting charging for client ${identity}`);
      return res.status(500).json({error: error.message});
    }
  }

  async stopCharging(req: Request, res: Response): Promise<Response> {
    const {identity} = req.params;
    if (!identity) {
      logger.warn('ChargerController: Missing identity');
      return res.status(400).json({error: 'Missing identity'});
    }

    logger.info(
      {requestParams: req.params},
      `ChargerController: Received stopAllCharging request for client ${identity}`
    );

    const transactions = await this.transactionRepository.getTransactions({identity, status: 'active'});
    if (!transactions || transactions.length === 0) {
      logger.warn(`ChargerController: No active transactions found for client ${identity}`);
      return res.status(400).json({error: 'No active transaction found'});
    }

    const responses = [];
    for (const transaction of transactions) {
      const payload = {transactionId: transaction.transactionId};
      try {
        logger.debug(
          `ChargerController: Sending RemoteStopTransaction request for client ${identity} for transaction ${transaction.transactionId}`,
          payload
        );
        const response = await sendRequestToClient(identity, 'RemoteStopTransaction', payload);
        logger.info(
          `ChargerController: Charging stopped successfully for client ${identity} (transaction: ${transaction.transactionId})`
        );
        responses.push({transactionId: transaction.transactionId, response});
      } catch (error: any) {
        logger.error(
          error,
          `ChargerController: Error stopping charging for client ${identity} for transaction ${transaction.transactionId}`
        );
        responses.push({transactionId: transaction.transactionId, error: error.message});
      }
    }

    return res.json({
      message: 'Stop transactions request processed',
      responses,
    });
  }

  async chargeDefault(req: Request, res: Response): Promise<Response> {
    const {identity} = req.params;
    if (!identity) {
      logger.warn('ChargerController: Missing identity');
      return res.status(400).json({error: 'Missing identity'});
    }
    logger.info(`ChargerController: Received chargeDefault request for client ${identity}`);
    try {
      const defaultPayload = {idTag: 'defaultIdTag', connectorId: 1};
      logger.debug(
        `ChargerController: Sending RemoteStartTransaction with default payload for client ${identity}`,
        defaultPayload
      );
      const response = await sendRequestToClient(identity, 'RemoteStartTransaction', defaultPayload);
      logger.info(`ChargerController: Charging started with default settings for client ${identity}`);
      return res.json({
        message: 'Charging started with default settings.',
        details: response,
      });
    } catch (error: any) {
      logger.error(error, `ChargerController: Error starting charging with default settings for client ${identity}`);
      return res.status(500).json({error: error.message});
    }
  }

  async triggerMessage(req: Request, res: Response): Promise<Response> {
    const {identity} = req.params;
    logger.info(`ChargerController: Received triggerMessage request for client ${identity}`, {requestBody: req.body});
    const {requestedMessage, connectorId} = req.body;
    if (!requestedMessage) {
      logger.warn(`ChargerController: Missing requestedMessage for client ${identity}`);
      return res.status(400).json({error: 'requestedMessage is required'});
    }
    try {
      const payload = {
        requestedMessage,
        connectorId: connectorId || 1,
      };
      logger.debug(`ChargerController: Sending TriggerMessage for client ${identity} with payload`, payload);
      const response = await sendRequestToClient(identity, 'TriggerMessage', payload);
      logger.info(`ChargerController: TriggerMessage request sent successfully for client ${identity}`);
      return res.json({
        message: 'TriggerMessage request sent successfully',
        details: response,
      });
    } catch (error: any) {
      logger.error(error, `ChargerController: Error triggering message for client ${identity}`);
      return res.status(500).json({error: error.message});
    }
  }

  async changeCurrent(req: Request, res: Response): Promise<Response> {
    const {identity} = req.params;
    if (!identity) {
      logger.warn('ChargerController: Missing identity');
      return res.status(400).json({error: 'Missing identity'});
    }
    logger.info(`ChargerController: Received changeCurrent request for client ${identity}`, {requestBody: req.body});
    const transactions = await this.transactionRepository.getTransactions({identity, status: 'active'});
    if (transactions.length > 1) {
      logger.warn(`ChargerController: Multiple active transactions found for client ${identity}`);
      return res.status(400).json({error: 'Multiple active transactions found, specify transactionId'});
    }
    if (transactions.length === 0 || !transactions[0] || transactions[0].transactionId == null) {
      logger.warn(`ChargerController: No active transaction found for client ${identity}`);
      return res.status(400).json({error: 'No active transaction found'});
    }
    const {desiredCurrent} = req.body;
    if (!desiredCurrent) {
      logger.warn(`ChargerController: Missing desiredCurrent for client ${identity}`);
      return res.status(400).json({error: 'desiredCurrent is required'});
    }
    const targetTransactionId = req.body.transactionId || transactions[0].transactionId;
    const setChargingProfilePayload = {
      connectorId: 1,
      csChargingProfiles: {
        chargingProfileId: 26771,
        stackLevel: 1,
        chargingProfilePurpose: 'TxProfile',
        chargingProfileKind: 'Absolute',
        transactionId: targetTransactionId,
        chargingSchedule: {
          chargingRateUnit: 'A',
          chargingSchedulePeriod: [{startPeriod: 0, limit: desiredCurrent}],
        },
      },
    };

    try {
      logger.debug(
        `ChargerController: Sending SetChargingProfile for client ${identity} with payload`,
        setChargingProfilePayload
      );
      const response = await sendRequestToClient(identity, 'SetChargingProfile', setChargingProfilePayload);
      logger.info(`ChargerController: Charging current updated successfully for client ${identity}`);
      return res.json({
        message: 'Charging current updated successfully',
        details: response,
      });
    } catch (error: any) {
      logger.error(error, `ChargerController: Error updating charging current for client ${identity}`);
      return res.status(500).json({error: error.message});
    }
  }

  async getConfiguration(req: Request, res: Response): Promise<Response> {
    const {identity} = req.params;
    logger.info(`ChargerController: Received getConfiguration request for client ${identity}`);
    try {
      const configResponse = await sendRequestToClient(identity, 'GetConfiguration', {});
      logger.info(`ChargerController: Configuration retrieved successfully for client ${identity}`);
      return res.json({
        message: 'Config retrieved successfully',
        configResponse,
      });
    } catch (error: any) {
      logger.error(error, `ChargerController: Error retrieving configuration for client ${identity}`);
      return res.status(500).json({error: error.message});
    }
  }
}
