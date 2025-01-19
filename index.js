import express from 'express';
import { RPCServer, RPCClient, createRPCError } from 'ocpp-rpc';

const app = express();
app.use(express.json());

const PORT = 3000;
const httpServer = app.listen(PORT, 'localhost', () => {
  console.log(`HTTP server listening on http://localhost:${PORT}`);
});

const ocppServer = new RPCServer({
  protocols: ['ocpp1.6'], // subprotocol(s) we accept
  strictMode: true,       // enable strict request/response validation
});

/**
 * This map tracks currently connected OCPP clients,
 * by their identity string (e.g. "user1-chargerA").
 * Key = client.identity
 * Value = RPCClient instance
 */
const connectedClients = new Map();

/**
 * This map "persists" user-charger combos
 * Key = uniqueUrl (e.g. "userId-chargerId")
 * Value = { userId, chargerId }
 */
const persistentMapping = new Map();

/* ----------------------------------------------------
   (C) Express routes
----------------------------------------------------- */

/** Create a new charger mapping.
 *  Example: POST /chargers { "userId": "user1", "chargerId": "chargerA" }
 */
app.post('/chargers', (req, res) => {
  const { userId, chargerId } = req.body;
  if (!userId || !chargerId) {
    return res.status(400).json({ error: "Missing userId or chargerId" });
  }
  const uniqueUrl = `${userId}-${chargerId}`;
  persistentMapping.set(uniqueUrl, { userId, chargerId });

  // The charger will connect to ws://localhost:3000/userId-chargerId
  res.json({ ocppUrl: `ws://localhost:3000/${uniqueUrl}` });
});

/** List connected charger clients */
app.get('/connected', (req, res) => {
  const clients = Array.from(connectedClients.keys());
  res.json({ connectedClients: clients });
});

/** Show the persistent mapping */
app.get('/persistent', (req, res) => {
  const entries = Array.from(persistentMapping.entries());
  res.json({ persistentMapping: entries });
});

/**
 * Example endpoint to start charging,
 * passing a charging profile inside RemoteStartTransaction.
 */
app.post('/charge/:clientId', async (req, res) => {
  const { clientId } = req.params;
  const { desiredPower } = req.body;

  if (!desiredPower) {
    return res.status(400).json({ error: "desiredPower is required" });
  }

  try {
    // Build the transaction-level profile
    // (TxProfile) included in RemoteStartTransaction
    const remoteStartTransactionPayload = {
      idTag: "myIdTag123",
      connectorId: 1,
      chargingProfile: {
        chargingProfileId: 1,
        stackLevel: 1,
        chargingProfilePurpose: "TxProfile",  // transaction-based
        chargingProfileKind: "Absolute",
        validFrom: new Date().toISOString(),
        validTo: new Date(Date.now() + 3600000).toISOString(),
        chargingSchedule: {
          duration: 3600,             // total seconds
          chargingRateUnit: "W",      // or "A"
          chargingSchedulePeriod: [
            {
              startPeriod: 0,         // in seconds from 'validFrom'
              limit: desiredPower,    // e.g. 1000 for 1kW
              numberPhases: 3         // optional
            }
          ]
        }
      }
    };

    // Directly start the transaction with the profile
    const response = await sendRequestToClient(clientId, "RemoteStartTransaction", remoteStartTransactionPayload);

    res.json({
      message: "Charging started successfully",
      details: response
    });
  } catch (error) {
    console.error("Error starting charging:", error);
    res.status(500).json({ error: error.message });
  }
});

httpServer.on('upgrade', ocppServer.handleUpgrade);

ocppServer.on('client', async (client) => {
  console.log(`Client connected with identity: ${client.identity}`);
  const uniqueUrl = client.identity; // e.g. "user1-chargerA"

  const mapping = persistentMapping.get(uniqueUrl);
  if (!mapping) {
    console.error(`No mapping found in persistentMapping for: ${uniqueUrl}`);
    client.close();
    return;
  }

  // Add to connectedClients
  connectedClients.set(client.identity, client);
  console.log(`Charger connected: ${client.identity}`);

  /* ---------- Set up request handlers for this client ---------- */

  // Basic OCPP handlers:
  client.handle('BootNotification', ({ params }) => {
    console.log(`BootNotification from ${client.identity}`, params);
    // respond "Accepted"
    return {
      status: "Accepted",
      interval: 300,
      currentTime: new Date().toISOString()
    };
  });

  client.handle('Heartbeat', ({ params }) => {
    console.log(`Heartbeat from ${client.identity}`, params);
    return {
      currentTime: new Date().toISOString()
    };
  });

  client.handle('StatusNotification', ({ params }) => {
    console.log(`StatusNotification from ${client.identity}`, params);
    return {};
  });

  client.handle('Authorize', ({ params }) => {
    console.log(`Authorize from ${client.identity}`, params);
    return {
      idTagInfo: {
        status: "Accepted"
      }
    };
  });

  client.handle('StartTransaction', ({ params }) => {
    console.log(`StartTransaction from ${client.identity}`, params);
    return {
      transactionId: 123,
      idTagInfo: {
        status: "Accepted"
      }
    };
  });

  client.handle(({ method, params }) => {
    console.log(`Unrecognized method ${method} from ${client.identity}:`, params);
    throw createRPCError("NotImplemented");
  });

  // Client disconnect event
  client.on('close', () => {
    connectedClients.delete(client.identity);
    console.log(`Charger disconnected: ${client.identity}`);
  });
});

/**
 * Helper to Send a Request to a Connected Client
 */
async function sendRequestToClient(clientId, method, params) {
  /** @type {RPCClient} */
  const client = connectedClients.get(clientId);
  if (!client) {
    throw new Error(`Client with ID ${clientId} is not connected.`);
  }
  try {
    const response = await client.call(method, params);
    console.log(`Response from ${clientId} for ${method}:`, response);
    return response;
  } catch (error) {
    console.error(`Error sending ${method} to ${clientId}:`, error);
    throw error;
  }
}