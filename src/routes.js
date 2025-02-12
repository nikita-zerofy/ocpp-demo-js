import express from 'express';
import logger from './logger';
import { connectedClients, pendingChargingProfiles } from './db';
import config from './config';
import sendRequestToClient from './request';
import { createChargerRepository, createTransactionRepository } from './db';
import { Charger } from './model/charger';

const cfg = config();

const routes = express.Router();

(async () => {
  const chargerRepository = await createChargerRepository();
  const transactionRepository = await createTransactionRepository();

  /** POST /chargers
   *  Example: { "userId": "user1", "chargerId": "chargerA", "dwellingId": "dwelling1" }
   */
  routes.post('/chargers', async (req, res) => {
    const { userId, chargerId, dwellingId, serviceId } = req.body;
    if (!userId || !chargerId || !dwellingId || !serviceId) {
      return res.status(400).json({ error: "Missing userId, chargerId, or dwellingId" });
    }

    try {
      const charger = new Charger(chargerId, userId, dwellingId, undefined, undefined, undefined, undefined, undefined, undefined, undefined, undefined, undefined, serviceId);
      await chargerRepository.addCharger(charger);
    } catch (err) {
      logger.error(err, 'Failed to insert charger');
      return res.status(400).json({ error: err.message });
    }

    res.json({ ocppUrl: `ws://${cfg.host}:${cfg.port}`, identity: chargerId });
  });

  /** GET /chargers
   *  Returns all chargers stored in the repository.
   */
  routes.get('/chargers', async (req, res) => {
    try {
      const chargers = await chargerRepository.getAllChargers();
      res.json({ chargers });
    } catch (error) {
      logger.error(error, 'Failed to retrieve chargers');
      res.status(500).json({ error: error.message });
    }
  });

  /** GET /chargers/:chargerId
   *  Returns details for a specific charger.
   */
  routes.get('/chargers/:chargerId', async (req, res) => {
    const { chargerId } = req.params;
    try {
      const charger = await chargerRepository.getCharger(chargerId);
      if (!charger) {
        return res.status(404).json({ error: "Charger not found" });
      }
      res.json({ charger });
    } catch (error) {
      logger.error(error, 'Failed to retrieve charger by id');
      res.status(500).json({ error: error.message });
    }
  });

  /** POST /charge/:clientId
   *  Start a charging session and store a pending charging profile.
   */
  routes.post('/charge/:clientId', async (req, res) => {
    const { clientId } = req.params;
    const { current, duration } = req.body;
    if (!current || !duration) {
      return res.status(400).json({ error: "current/duration is required" });
    }
    try {
      const response = await sendRequestToClient(
        clientId,
        "RemoteStartTransaction",
        { idTag: "myIdTag123", connectorId: 1 }
      );
      pendingChargingProfiles.set(clientId, {
        current,
        duration,
        transactionId: null // Will be updated later
      });

      res.json({
        message: "Charging started. Profile will be applied once active.",
        details: response
      });
    } catch (error) {
      logger.error(error, `Error starting charging for ${clientId}`);
      res.status(500).json({ error: error.message });
    }
  });

  /** POST /stopCharging/:clientId
   *  Stop a charging session using a provided transactionId.
   */
  routes.post('/stopCharging/:clientId', async (req, res) => {
    const { clientId } = req.params;
    const { transactionId } = req.body;

    if (!transactionId) {
      return res.status(400).json({ error: "transactionId is required" });
    }

    try {
      const payload = { transactionId };
      const response = await sendRequestToClient(clientId, "RemoteStopTransaction", payload);

      res.json({
        message: "Charging stopped successfully",
        response
      });
    } catch (error) {
      logger.error(error, `Error stopping charging for ${clientId}`);
      res.status(500).json({ error: error.message });
    }
  });

  /**
   * POST /chargeDefault/:clientId
   * Start charging using default settings (without applying any charging profile).
   * Example payload (if needed): {}
   */
  routes.post('/chargeDefault/:clientId', async (req, res) => {
    const { clientId } = req.params;
    try {
      const defaultPayload = { idTag: "defaultIdTag", connectorId: 1 };
      const response = await sendRequestToClient(clientId, "RemoteStartTransaction", defaultPayload);
      res.json({
        message: "Charging started with default settings.",
        details: response
      });
    } catch (error) {
      logger.error(error, `Error starting charging with default settings for ${clientId}`);
      res.status(500).json({ error: error.message });
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
    const { clientId } = req.params;
    const { requestedMessage, connectorId } = req.body;

    if (!requestedMessage) {
      return res.status(400).json({ error: "requestedMessage is required" });
    }

    try {
      const payload = {
        requestedMessage,
        connectorId: connectorId || 1
      };

      const response = await sendRequestToClient(clientId, "TriggerMessage", payload);

      res.json({
        message: "TriggerMessage request sent successfully",
        details: response
      });
    } catch (error) {
      logger.error(error, `Error triggering message for ${clientId}`);
      res.status(500).json({ error: error.message });
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
    const { clientId } = req.params;
    const { transactionId, desiredCurrent } = req.body;

    if (!transactionId) {
      return res.status(400).json({ error: "transactionId is required" });
    }
    if (!desiredCurrent) {
      return res.status(400).json({ error: "desiredCurrent is required" });
    }

    const setChargingProfilePayload = {
      connectorId: 1,
      csChargingProfiles: {
        chargingProfileId: 26771,
        stackLevel: 1,
        chargingProfilePurpose: "TxProfile",
        chargingProfileKind: "Absolute",
        transactionId: transactionId,
        chargingSchedule: {
          chargingRateUnit: "A",
          chargingSchedulePeriod: [
            { startPeriod: 0, limit: desiredCurrent }
          ]
        }
      }
    };

    try {
      const response = await sendRequestToClient(clientId, "SetChargingProfile", setChargingProfilePayload);
      res.json({
        message: "Charging current updated successfully",
        details: response
      });
    } catch (error) {
      logger.error(error, `Error updating charging current for ${clientId}`);
      res.status(500).json({ error: error.message });
    }
  });

  /** GET /config/:clientId
   *  Retrieve configuration details from the charger.
   */
  routes.get('/config/:clientId', async (req, res) => {
    const { clientId } = req.params;
    try {
      const configResponse = await sendRequestToClient(clientId, "GetConfiguration", {});

      res.json({
        message: "Config retrieved successfully",
        configResponse
      });
    } catch (error) {
      logger.error(error, `Error retrieving configuration for client ${clientId}`);
      res.status(500).json({ error: error.message });
    }
  });

  /** GET /transactions
   *  Retrieve transactions with optional filtering by chargerId and status.
   */
  routes.get('/transactions', async (req, res) => {
    try {
      const { chargerId, status } = req.query;
      const transactions = await transactionRepository.getTransactions({ chargerId, status });
      res.json({ transactions });
    } catch (error) {
      logger.error(error, 'Failed to retrieve transactions');
      res.status(500).json({ error: error.message });
    }
  });

  /** GET /connected
   *  List the currently connected charger identities
   */
  routes.get('/connected', (req, res) => {
    const clients = Array.from(connectedClients.keys());
    res.json({ connectedClients: clients });
  });
})();

export default routes;
