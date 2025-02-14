import express from 'express';
import logger from './logger';
import {connectedClients, pendingChargingProfiles} from './db';
import config from './config';
import sendRequestToClient from './request';
import {chargerRepository, transactionRepository} from './db';
import {Charger} from './model/charger';
import {randomUUID} from 'node:crypto';


const routes = express.Router();

/** POST /chargers
 *  Example: { "userId": "user1", "chargerId": "chargerA", "dwellingId": "dwelling1", "serviceId": "serviceX", "projectId": "proj1" }
 */
routes.post('/chargers', async (req, res) => {
  logger.info('[/chargers] Received POST request.', {requestBody: req.body});
  const {userId, dwellingId, serviceId, projectId} = req.body;
  if (!userId || !dwellingId || !serviceId || !projectId) {
    logger.warn('[/chargers] Missing required fields.', {userId, dwellingId, serviceId, projectId});
    return res.status(400).json({error: 'Missing userId, dwellingId, serviceId or projectId'});
  }
  try {
    const charger = new Charger(randomUUID().toUpperCase(), userId, dwellingId, serviceId, projectId);
    logger.debug('[/chargers] New charger created.', {charger});
    await chargerRepository.addCharger(charger);
    logger.info('[/chargers] Charger added to repository.', {identity: charger.identity});
    res.json({ocppUrl: `ws://${config.host}:${config.port}`, identity: charger.identity});
  } catch (err) {
    logger.error(err, '[/chargers] Failed to insert charger.');
    return res.status(400).json({error: err.message});
  }
});

/** GET /chargers
 *  Returns all chargers stored in the repository.
 */
routes.get('/chargers', async (req, res) => {
  logger.info('[/chargers] Received GET request for all chargers.');
  try {
    const chargers = await chargerRepository.getAllChargers();
    logger.info('[/chargers] Retrieved chargers from repository.', {count: chargers.length});
    res.json({chargers});
  } catch (error) {
    logger.error(error, '[/chargers] Failed to retrieve chargers.');
    res.status(500).json({error: error.message});
  }
});

/** GET /chargers/:identity
 *  Returns details for a specific charger.
 */
routes.get('/chargers/:identity', async (req, res) => {
  const {identity} = req.params;
  logger.info(`[/chargers/${identity}] Received GET request for charger details.`);
  try {
    const charger = await chargerRepository.getCharger(identity);
    if (!charger) {
      logger.warn(`[/chargers/${identity}] Charger not found.`);
      return res.status(404).json({error: 'Charger not found'});
    }
    logger.info(`[/chargers/${identity}] Charger details retrieved.`, {charger});
    res.json({charger});
  } catch (error) {
    logger.error(error, `[/chargers/${identity}] Failed to retrieve charger by id.`);
    res.status(500).json({error: error.message});
  }
});

/** POST /charge/:clientId
 *  Start a charging session and store a pending charging profile.
 */
routes.post('/charge/:clientId', async (req, res) => {
  const {clientId} = req.params;
  logger.info(`[/charge/${clientId}] Received request to start charging.`, {requestBody: req.body});
  const {current, duration} = req.body;
  if (!current || !duration) {
    logger.warn(`[/charge/${clientId}] Missing current or duration in request.`);
    return res.status(400).json({error: 'current/duration is required'});
  }
  try {
    logger.debug(`[/charge/${clientId}] Sending RemoteStartTransaction request.`);
    const response = await sendRequestToClient(clientId, 'RemoteStartTransaction', {
      idTag: 'myIdTag123',
      connectorId: 1,
    });
    pendingChargingProfiles.set(clientId, {
      current,
      duration,
      transactionId: null, // Will be updated later
    });
    logger.info(`[/charge/${clientId}] Charging started. Pending profile stored.`, {profile: {current, duration}});
    res.json({
      message: 'Charging started. Profile will be applied once active.',
      details: response,
    });
  } catch (error) {
    logger.error(error, `[/charge/${clientId}] Error starting charging.`);
    res.status(500).json({error: error.message});
  }
});

/** POST /stopCharging/:clientId
 *  Stop a charging session using a provided transactionId.
 */
routes.post('/stopCharging/:clientId', async (req, res) => {
  const {clientId} = req.params;
  logger.info(`[/stopCharging/${clientId}] Received request to stop charging.`, {requestBody: req.body});
  const {transactionId} = req.body;
  if (!transactionId) {
    logger.warn(`[/stopCharging/${clientId}] Missing transactionId.`);
    return res.status(400).json({error: 'transactionId is required'});
  }
  try {
    const payload = {transactionId};
    logger.debug(`[/stopCharging/${clientId}] Sending RemoteStopTransaction request with payload:`, payload);
    const response = await sendRequestToClient(clientId, 'RemoteStopTransaction', payload);
    logger.info(`[/stopCharging/${clientId}] Charging stopped successfully for transactionId: ${transactionId}`);
    res.json({
      message: 'Charging stopped successfully',
      response,
    });
  } catch (error) {
    logger.error(error, `[/stopCharging/${clientId}] Error stopping charging.`);
    res.status(500).json({error: error.message});
  }
});

/**
 * POST /chargeDefault/:clientId
 * Start charging using default settings (without applying any charging profile).
 * Example payload (if needed): {}
 */
routes.post('/chargeDefault/:clientId', async (req, res) => {
  const {clientId} = req.params;
  logger.info(`[/chargeDefault/${clientId}] Received request to start charging with default settings.`);
  try {
    const defaultPayload = {idTag: 'defaultIdTag', connectorId: 1};
    logger.debug(`[/chargeDefault/${clientId}] Sending RemoteStartTransaction with default payload:`, defaultPayload);
    const response = await sendRequestToClient(clientId, 'RemoteStartTransaction', defaultPayload);
    logger.info(`[/chargeDefault/${clientId}] Charging started with default settings.`);
    res.json({
      message: 'Charging started with default settings.',
      details: response,
    });
  } catch (error) {
    logger.error(error, `[/chargeDefault/${clientId}] Error starting charging with default settings.`);
    res.status(500).json({error: error.message});
  }
});

/**
 * POST /triggerMessage/:clientId
 * Triggers a TriggerMessage request to the specified charge point.
 * Expected payload:
 * {
 *   "requestedMessage": "Heartbeat",  // or BootNotification, MeterValues, etc.
 *   "connectorId": 1                 // optional, default is 1
 * }
 */
routes.post('/triggerMessage/:clientId', async (req, res) => {
  const {clientId} = req.params;
  logger.info(`[/triggerMessage/${clientId}] Received trigger message request.`, {requestBody: req.body});
  const {requestedMessage, connectorId} = req.body;
  if (!requestedMessage) {
    logger.warn(`[/triggerMessage/${clientId}] Missing requestedMessage.`);
    return res.status(400).json({error: 'requestedMessage is required'});
  }
  try {
    const payload = {
      requestedMessage,
      connectorId: connectorId || 1,
    };
    logger.debug(`[/triggerMessage/${clientId}] Sending TriggerMessage with payload:`, payload);
    const response = await sendRequestToClient(clientId, 'TriggerMessage', payload);
    logger.info(`[/triggerMessage/${clientId}] TriggerMessage request sent successfully.`);
    res.json({
      message: 'TriggerMessage request sent successfully',
      details: response,
    });
  } catch (error) {
    logger.error(error, `[/triggerMessage/${clientId}] Error triggering message.`);
    res.status(500).json({error: error.message});
  }
});

/**
 * POST /changeCurrent/:clientId
 * Update the charging current for an active transaction.
 *
 * Expected payload:
 * {
 *   "transactionId": 123,  // Required: Active transaction ID
 *   "duration": 3600,      // Required: Duration in seconds for the new profile
 *   "desiredCurrent": 10   // Required: Desired current in Amps
 * }
 */
routes.post('/changeCurrent/:clientId', async (req, res) => {
  const {clientId} = req.params;
  logger.info(`[/changeCurrent/${clientId}] Received request to change charging current.`, {requestBody: req.body});
  const {transactionId, desiredCurrent} = req.body;

  if (!transactionId) {
    logger.warn(`[/changeCurrent/${clientId}] Missing transactionId.`);
    return res.status(400).json({error: 'transactionId is required'});
  }
  if (!desiredCurrent) {
    logger.warn(`[/changeCurrent/${clientId}] Missing desiredCurrent.`);
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
    logger.debug(`[/changeCurrent/${clientId}] Sending SetChargingProfile with payload:`, setChargingProfilePayload);
    const response = await sendRequestToClient(clientId, 'SetChargingProfile', setChargingProfilePayload);
    logger.info(`[/changeCurrent/${clientId}] Charging current updated successfully.`);
    res.json({
      message: 'Charging current updated successfully',
      details: response,
    });
  } catch (error) {
    logger.error(error, `[/changeCurrent/${clientId}] Error updating charging current.`);
    res.status(500).json({error: error.message});
  }
});

/** GET /config/:clientId
 *  Retrieve configuration details from the charger.
 */
routes.get('/config/:clientId', async (req, res) => {
  const {clientId} = req.params;
  logger.info(`[/config/${clientId}] Received request for charger configuration.`);
  try {
    const configResponse = await sendRequestToClient(clientId, 'GetConfiguration', {});
    logger.info(`[/config/${clientId}] Configuration retrieved successfully.`);
    res.json({
      message: 'Config retrieved successfully',
      configResponse,
    });
  } catch (error) {
    logger.error(error, `[/config/${clientId}] Error retrieving configuration.`);
    res.status(500).json({error: error.message});
  }
});

/** GET /transactions
 *  Retrieve transactions with optional filtering by identity and status.
 */
routes.get('/transactions', async (req, res) => {
  logger.info('[/transactions] Received request for transactions.', {query: req.query});
  try {
    const {identity, status} = req.query;
    const transactions = await transactionRepository.getTransactions({identity: identity, status});
    logger.info(`[/transactions] Retrieved ${transactions.length} transaction(s).`);
    res.json({transactions});
  } catch (error) {
    logger.error(error, '[/transactions] Failed to retrieve transactions.');
    res.status(500).json({error: error.message});
  }
});

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
