import router from 'express';
import logger from './logger.js';
import {connectedClients, dbPromise, pendingChargingProfiles} from "./db.js";
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

routes.get('/transactions', async (req, res) => {
  try {
    const db = await dbPromise;
    const { chargerId, status } = req.query;
    let query = 'SELECT * FROM transactions';
    const conditions = [];
    const params = [];
    if (chargerId) {
      conditions.push('chargerId = ?');
      params.push(chargerId);
    }
    if (status) {
      conditions.push('status = ?');
      params.push(status);
    }
    if (conditions.length > 0) {
      query += ' WHERE ' + conditions.join(' AND ');
    }
    const transactions = await db.all(query, params);
    res.json({ transactions });
  } catch (error) {
    logger.error(error, 'Failed to retrieve transactions');
    res.status(500).json({ error: error.message });
  }
});

export default routes;
