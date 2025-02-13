import {ChargerRepository} from '../database';
import {Database} from 'sqlite';
import {Charger} from "../../model/charger";
import logger from "../../logger";

export class SqliteChargerRepository implements ChargerRepository {
  constructor(private db: Database) {
    logger.info('SqliteChargerRepository instantiated.');
  }

  async getCharger(identity: string): Promise<Charger | null> {
    logger.info(`Entering getCharger with identity: ${identity}`);
    try {
      const row = await this.db.get('SELECT * FROM chargers WHERE identity = ?', identity);
      logger.info(`Query result for identity ${identity}: ${JSON.stringify(row)}`);

      if (!row) {
        logger.info(`No charger found for identity: ${identity}`);
        return null;
      }

      const charger = new Charger(
        row.identity,
        row.userId,
        row.dwellingId,
        row.serviceId,
        row.projectId,
        row.vendor,
        row.model,
        row.serialNumber,
        row.firmwareVersion,
        row.firstBootNotificationReceived,
        row.lastStatus,
        row.lastStatusTimestamp,
        row.errorCode,
        row.lastHeartbeat,
      );
      logger.info(`Charger retrieved for identity: ${identity}`);
      return charger;
    } catch (error) {
      logger.error(`Error in getCharger for identity: ${identity}`, error);
      throw error;
    }
  }

  async addCharger(charger: Charger): Promise<void> {
    logger.info(`Entering addCharger for identity: ${charger.identity}`);
    try {
      await this.db.run(
        'INSERT INTO chargers (identity, userId, dwellingId, serviceId, projectId) VALUES (?, ?, ?, ?, ?)',
        charger.identity,
        charger.userId,
        charger.dwellingId,
        charger.serviceId,
        charger.projectId
      );
      logger.info(`Charger added with identity: ${charger.identity}`);
    } catch (error) {
      logger.error(`Error in addCharger for identity: ${charger.identity}`, error);
      throw error;
    }
  }

  async updateCharger(identity: string, updates: Partial<Charger>): Promise<void> {
    logger.info(`Entering updateCharger for identity: ${identity} with updates: ${JSON.stringify(updates)}`);
    try {
      const {vendor, model, serialNumber, firmwareVersion, firstBootNotificationReceived} = updates;
      await this.db.run(
        `
            UPDATE chargers
            SET vendor                        = ?,
                model                         = ?,
                serialNumber                  = ?,
                firmwareVersion               = ?,
                firstBootNotificationReceived = ?
            WHERE identity = ?
        `,
        vendor,
        model,
        serialNumber,
        firmwareVersion,
        firstBootNotificationReceived,
        identity
      );
      logger.info(`Charger updated for identity: ${identity}`);
    } catch (error) {
      logger.error(`Error in updateCharger for identity: ${identity}`, error);
      throw error;
    }
  }

  async getAllChargers(): Promise<Charger[]> {
    logger.info("Entering getAllChargers");
    try {
      const rows = await this.db.all('SELECT * FROM chargers');
      logger.debug(`Query result for all chargers: ${JSON.stringify(rows)}`);
      const chargers = rows.map(row => new Charger(
        row.identity,
        row.userId,
        row.dwellingId,
        row.serviceId,
        row.projectId,
        row.vendor,
        row.model,
        row.serialNumber,
        row.firmwareVersion,
        row.firstBootNotificationReceived,
        row.lastStatus,
        row.lastStatusTimestamp,
        row.errorCode,
        row.lastHeartbeat,
      ));
      logger.info(`Retrieved ${chargers.length} charger(s).`);
      return chargers;
    } catch (error) {
      logger.error("Error in getAllChargers", error);
      throw error;
    }
  }
}