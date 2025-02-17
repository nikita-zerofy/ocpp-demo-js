import type {Request, Response} from 'express';
import {ChargerRepository} from '../repository/database';
import {Charger} from '../model/charger';
import logger from '../logger';
import {randomUUID} from 'node:crypto';
import config from '../config';
import sendRequestToClient from '../request';
import {pendingChargingProfiles} from '../db';

export class ChargerController {
  constructor(private chargerRepository: ChargerRepository) {
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
      const charger = await this.chargerRepository.getCharger(identity);
      if (!charger) {
        logger.warn(`ChargerController: Charger not found for identity ${identity}`);
        return res.status(404).json({error: 'Charger not found'});
      }
      logger.info(`ChargerController: Charger retrieved`, {charger});
      return res.json({charger});
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
    const {clientId} = req.params;
    logger.info(`ChargerController: Received startCharging request for client ${clientId}`, {requestBody: req.body});
    const {current, duration} = req.body;
    if (!current || !duration) {
      logger.warn(`ChargerController: Missing current or duration in request for client ${clientId}`);
      return res.status(400).json({error: 'current/duration is required'});
    }
    try {
      logger.debug(`ChargerController: Sending RemoteStartTransaction request for client ${clientId}`);
      const response = await sendRequestToClient(clientId, 'RemoteStartTransaction', {
        idTag: 'myIdTag123',
        connectorId: 1,
      });
      pendingChargingProfiles.set(clientId!, {
        current,
        duration,
        transactionId: null, // To be updated later
      });
      logger.info(`ChargerController: Charging started for client ${clientId}`, {profile: {current, duration}});
      return res.json({
        message: 'Charging started. Profile will be applied once active.',
        details: response,
      });
    } catch (error: any) {
      logger.error(error, `ChargerController: Error starting charging for client ${clientId}`);
      return res.status(500).json({error: error.message});
    }
  }

  async stopCharging(req: Request, res: Response): Promise<Response> {
    const {clientId} = req.params;
    logger.info(`ChargerController: Received stopCharging request for client ${clientId}`, {requestBody: req.body});
    const {transactionId} = req.body;
    if (!transactionId) {
      logger.warn(`ChargerController: Missing transactionId for client ${clientId}`);
      return res.status(400).json({error: 'transactionId is required'});
    }
    try {
      const payload = {transactionId};
      logger.debug(
        `ChargerController: Sending RemoteStopTransaction request for client ${clientId} with payload`,
        payload
      );
      const response = await sendRequestToClient(clientId, 'RemoteStopTransaction', payload);
      logger.info(
        `ChargerController: Charging stopped successfully for client ${clientId} (transaction: ${transactionId})`
      );
      return res.json({
        message: 'Charging stopped successfully',
        response,
      });
    } catch (error: any) {
      logger.error(error, `ChargerController: Error stopping charging for client ${clientId}`);
      return res.status(500).json({error: error.message});
    }
  }

  async chargeDefault(req: Request, res: Response): Promise<Response> {
    const {clientId} = req.params;
    logger.info(`ChargerController: Received chargeDefault request for client ${clientId}`);
    try {
      const defaultPayload = {idTag: 'defaultIdTag', connectorId: 1};
      logger.debug(
        `ChargerController: Sending RemoteStartTransaction with default payload for client ${clientId}`,
        defaultPayload
      );
      const response = await sendRequestToClient(clientId, 'RemoteStartTransaction', defaultPayload);
      logger.info(`ChargerController: Charging started with default settings for client ${clientId}`);
      return res.json({
        message: 'Charging started with default settings.',
        details: response,
      });
    } catch (error: any) {
      logger.error(error, `ChargerController: Error starting charging with default settings for client ${clientId}`);
      return res.status(500).json({error: error.message});
    }
  }

  async triggerMessage(req: Request, res: Response): Promise<Response> {
    const {clientId} = req.params;
    logger.info(`ChargerController: Received triggerMessage request for client ${clientId}`, {requestBody: req.body});
    const {requestedMessage, connectorId} = req.body;
    if (!requestedMessage) {
      logger.warn(`ChargerController: Missing requestedMessage for client ${clientId}`);
      return res.status(400).json({error: 'requestedMessage is required'});
    }
    try {
      const payload = {
        requestedMessage,
        connectorId: connectorId || 1,
      };
      logger.debug(`ChargerController: Sending TriggerMessage for client ${clientId} with payload`, payload);
      const response = await sendRequestToClient(clientId, 'TriggerMessage', payload);
      logger.info(`ChargerController: TriggerMessage request sent successfully for client ${clientId}`);
      return res.json({
        message: 'TriggerMessage request sent successfully',
        details: response,
      });
    } catch (error: any) {
      logger.error(error, `ChargerController: Error triggering message for client ${clientId}`);
      return res.status(500).json({error: error.message});
    }
  }

  async changeCurrent(req: Request, res: Response): Promise<Response> {
    const {clientId} = req.params;
    logger.info(`ChargerController: Received changeCurrent request for client ${clientId}`, {requestBody: req.body});
    const {transactionId, desiredCurrent} = req.body;
    if (!transactionId) {
      logger.warn(`ChargerController: Missing transactionId for client ${clientId}`);
      return res.status(400).json({error: 'transactionId is required'});
    }
    if (!desiredCurrent) {
      logger.warn(`ChargerController: Missing desiredCurrent for client ${clientId}`);
      return res.status(400).json({error: 'desiredCurrent is required'});
    }

    const setChargingProfilePayload = {
      connectorId: 1,
      csChargingProfiles: {
        chargingProfileId: 26771,
        stackLevel: 1,
        chargingProfilePurpose: 'TxProfile',
        chargingProfileKind: 'Absolute',
        transactionId: transactionId,
        chargingSchedule: {
          chargingRateUnit: 'A',
          chargingSchedulePeriod: [{startPeriod: 0, limit: desiredCurrent}],
        },
      },
    };

    try {
      logger.debug(
        `ChargerController: Sending SetChargingProfile for client ${clientId} with payload`,
        setChargingProfilePayload
      );
      const response = await sendRequestToClient(clientId, 'SetChargingProfile', setChargingProfilePayload);
      logger.info(`ChargerController: Charging current updated successfully for client ${clientId}`);
      return res.json({
        message: 'Charging current updated successfully',
        details: response,
      });
    } catch (error: any) {
      logger.error(error, `ChargerController: Error updating charging current for client ${clientId}`);
      return res.status(500).json({error: error.message});
    }
  }

  async getConfiguration(req: Request, res: Response): Promise<Response> {
    const {clientId} = req.params;
    logger.info(`ChargerController: Received getConfiguration request for client ${clientId}`);
    try {
      const configResponse = await sendRequestToClient(clientId, 'GetConfiguration', {});
      logger.info(`ChargerController: Configuration retrieved successfully for client ${clientId}`);
      return res.json({
        message: 'Config retrieved successfully',
        configResponse,
      });
    } catch (error: any) {
      logger.error(error, `ChargerController: Error retrieving configuration for client ${clientId}`);
      return res.status(500).json({error: error.message});
    }
  }
}
