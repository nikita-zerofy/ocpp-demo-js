/**
 * Helper: Send a request to a connected client.
 */
import {connectedClients} from "./db";
import logger from "./logger";

const sendRequestToClient = async (clientId, method, params) => {
  const client = connectedClients.get(clientId);
  if (!client) {
    throw new Error(`Client with ID ${clientId} is not connected.`);
  }
  const response = await client.call(method, params);
  logger.info({response}, `Response from ${clientId} for ${method}`);
  return response;
}

export default sendRequestToClient;
