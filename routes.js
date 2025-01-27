import router from 'express';
import logger from './logger.js';
import {connectedClients, dbPromise} from "./db.js";
import config from './config.js';
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

  const uniqueUrl = `${userId}-${chargerId}`;
  const db = await dbPromise;

  try {
    await db.run(`
      INSERT INTO chargers (userId, chargerId, uniqueUrl)
      VALUES (?, ?, ?)
    `, [userId, chargerId, uniqueUrl]);
  } catch (err) {
    logger.error(err, 'Failed to insert charger');
    return res.status(400).json({ error: err.message });
  }

  res.json({ ocppUrl: `ws://${cfg.host}:${cfg.port}/${uniqueUrl}` });
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
  const { desiredPower } = req.body;

  if (!desiredPower) {
    return res.status(400).json({ error: "desiredPower is required" });
  }

  try {
    // Build transaction-based profile
    const remoteStartTransactionPayload = {
      idTag: "myIdTag123",
      connectorId: 1,
      chargingProfile: {
        chargingProfileId: 1,
        stackLevel: 1,
        chargingProfilePurpose: "TxProfile",
        chargingProfileKind: "Absolute",
        validFrom: new Date().toISOString(),
        validTo: new Date(Date.now() + 3600000).toISOString(),
        chargingSchedule: {
          duration: 3600,
          chargingRateUnit: "W",
          chargingSchedulePeriod: [
            {
              startPeriod: 0,
              limit: desiredPower,
              numberPhases: 3
            }
          ]
        }
      }
    };

    const response = await sendRequestToClient(clientId, "RemoteStartTransaction", remoteStartTransactionPayload);
    res.json({
      message: "Charging started successfully",
      details: response
    });
  } catch (error) {
    logger.error(error, `Error starting charging for ${clientId}`);
    res.status(500).json({ error: error.message });
  }
});

/**
 * Helper: Send a request to a connected client.
 */
async function sendRequestToClient(clientId, method, params) {
  const client = connectedClients.get(clientId);
  if (!client) {
    throw new Error(`Client with ID ${clientId} is not connected.`);
  }
  const response = await client.call(method, params);
  logger.info({ response }, `Response from ${clientId} for ${method}`);
  return response;
}

export default routes;
