import router from 'express';
import logger from './logger.js';
import {connectedClients, dbPromise} from "./db.js";
import config from './config.js';
import sendRequestToClient from "./request.js";

const cfg = config();

const routes = router();

/** POST /chargers
 *  Example: { "userId": "user1", "chargerId": "chargerA" }
 */
routes.post('/chargers', async (req, res) => {
  const { userId, chargerId } = req.body;
  if (!userId || !chargerId) {
    return res.status(400).json({ error: "Missing userId or chargerId" });
  }

  const db = await dbPromise;

  try {
    await db.run(`
      INSERT INTO chargers (userId, chargerId)
      VALUES (?, ?)
    `, [userId, chargerId]);
  } catch (err) {
    logger.error(err, 'Failed to insert charger');
    return res.status(400).json({ error: err.message });
  }

  res.json({ ocppUrl: `ws://${cfg.host}:${cfg.port}`, identity: chargerId });
});

/** GET /connected
 *  List the currently connected charger identities
 */
routes.get('/connected', (req, res) => {
  const clients = Array.from(connectedClients.keys());
  res.json({ connectedClients: clients });
});

/** GET /persistent
 *  Show all chargers from the DB (stored "persistently")
 */
routes.get('/persistent', async (req, res) => {
  const db = await dbPromise;
  const rows = await db.all('SELECT * FROM chargers');
  res.json({ chargers: rows });
});

/** POST /charge/:clientId
 *  Instruct a connected client to RemoteStartTransaction with a charging profile
 *  Example body: { "desiredPower": 1500 }
 */
routes.post('/charge/:clientId', async (req, res) => {
  const { clientId } = req.params;
  const { current, duration } = req.body;

  if (!current || !duration) {
    return res.status(400).json({ error: "current/duration is required" });
  }

  try {
    const remoteStartTransactionPayload = {
      idTag: "myIdTag123",
      connectorId: 1
    };
    const response = await sendRequestToClient(clientId, "RemoteStartTransaction", remoteStartTransactionPayload);

    const setChargingProfilePayload = {
      connectorId: 1,
      csChargingProfiles: {
        chargingProfileId: 26771,
        stackLevel: 1,
        chargingProfilePurpose: "TxProfile",
        chargingProfileKind: "Absolute",
        transactionId: 123,
        validFrom: new Date().toISOString(),
        validTo: new Date(Date.now() + 3600000).toISOString(),
        chargingSchedule: {
          chargingRateUnit: "A",
          duration: duration,
          chargingSchedulePeriod: [
            { startPeriod: 0, limit: current }
          ]
        }
      }
    };
    const profileResponse = await sendRequestToClient(clientId, "SetChargingProfile", setChargingProfilePayload);

    res.json({
      message: "Charging started successfully",
      details: response,
      profileResponse
    });
  } catch (error) {
    logger.error(error, `Error starting charging for ${clientId}`);
    res.status(500).json({ error: error.message });
  }
});

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

routes.get('/config/:clientId', async (req, res) => {
  const { clientId } = req.params;
  try {
    const configResponse = await sendRequestToClient(clientId, "GetConfiguration", {});

    res.json({
      message: "Config retrieved successfully",
      configResponse: configResponse
    });
  } catch (error) {
    logger.error(error, `Error retrieving configuration for client ${clientId}`);
    res.status(500).json({ error: error.message });
  }
});

export default routes;
