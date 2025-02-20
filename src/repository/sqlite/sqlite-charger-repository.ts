import {ChargerRepository} from '../database';
import {Database} from 'sqlite';
import {Charger} from '../../model/charger';
import logger from '../../logger';

export class SqliteChargerRepository implements ChargerRepository {
  constructor(private db: Database) {
    logger.info('SqliteChargerRepository instantiated.');
  }

  async getCharger(identity: string): Promise<Charger | null> {
    logger.info(`Entering getCharger with identity: ${identity}`);
    try {
      const row = await this.db.get('SELECT * FROM chargers WHERE identity = ?', identity);
      logger.info({row}, `Query result for identity ${identity}`);

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
        row.power
      );
      logger.info(`Charger retrieved for identity: ${identity}`);
      return charger;
    } catch (error) {
      logger.error(`Error in getCharger for identity: ${identity}`, error);
      throw error;
    }
  }

  async addCharger(charger: Charger): Promise<void> {
    logger.info(`Entering addCharger for identity: ${charger.id}`);
    try {
      await this.db.run(
        'INSERT INTO chargers (identity, userId, dwellingId, serviceId, projectId) VALUES (?, ?, ?, ?, ?)',
        charger.id,
        charger.userId,
        charger.dwellingId,
        charger.serviceId,
        charger.projectId
      );
      logger.info(`Charger added with identity: ${charger.id}`);
    } catch (error) {
      logger.error(`Error in addCharger for identity: ${charger.id}`, error);
      throw error;
    }
  }

  async updateCharger(identity: string, updates: Partial<Charger>): Promise<void> {
    logger.info(`Entering updateCharger for identity: ${identity} with updates: ${JSON.stringify(updates)}`);
    try {
      const existing = await this.db.get('SELECT identity FROM chargers WHERE identity = ?', identity);
      if (!existing) {
        throw new Error(`Charger with identity ${identity} not found`);
      }

      const columns: string[] = [];
      const values: any[] = [];

      if (updates.vendor !== undefined) {
        columns.push('vendor = ?');
        values.push(updates.vendor);
      }
      if (updates.model !== undefined) {
        columns.push('model = ?');
        values.push(updates.model);
      }
      if (updates.serialNumber !== undefined) {
        columns.push('serialNumber = ?');
        values.push(updates.serialNumber);
      }
      if (updates.firmwareVersion !== undefined) {
        columns.push('firmwareVersion = ?');
        values.push(updates.firmwareVersion);
      }
      if (updates.firstBootNotificationReceived !== undefined) {
        columns.push('firstBootNotificationReceived = ?');
        values.push(updates.firstBootNotificationReceived);
      }
      if (updates.lastStatus !== undefined) {
        columns.push('lastStatus = ?');
        values.push(updates.lastStatus);
      }
      if (updates.lastStatusTimestamp !== undefined) {
        columns.push('lastStatusTimestamp = ?');
        values.push(updates.lastStatusTimestamp);
      }
      if (updates.errorCode !== undefined) {
        columns.push('errorCode = ?');
        values.push(updates.errorCode);
      }
      if (updates.lastHeartbeat !== undefined) {
        columns.push('lastHeartbeat = ?');
        values.push(updates.lastHeartbeat);
      }

      if (updates.power !== undefined) {
        columns.push('power = ?');
        values.push(updates.power);
      }

      if (columns.length === 0) {
        logger.info(`No updates provided for identity: ${identity}`);
        return;
      }

      values.push(identity);

      const sql = `
          UPDATE chargers
          SET ${columns.join(', ')}
          WHERE identity = ?
      `;
      await this.db.run(sql, ...values);
      logger.info(`Charger updated for identity: ${identity}`);
    } catch (error) {
      logger.error(`Error in updateCharger for identity: ${identity}`, error);
      throw error;
    }
  }

  async getAllChargers(): Promise<Charger[]> {
    logger.info('Entering getAllChargers');
    try {
      const rows = await this.db.all('SELECT * FROM chargers');
      logger.debug({rows}, `Query result for all chargers`);
      const chargers = rows.map(
        (row) =>
          new Charger(
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
            row.power
          )
      );
      logger.info(`Retrieved ${chargers.length} charger(s).`);
      return chargers;
    } catch (error) {
      logger.error('Error in getAllChargers', error);
      throw error;
    }
  }

  async deleteCharger(identity: string): Promise<void> {
    logger.info(`Entering deleteCharger for identity: ${identity}`);
    try {
      const existing = await this.db.get('SELECT identity FROM chargers WHERE identity = ?', identity);
      if (!existing) {
        throw new Error(`Charger with identity ${identity} not found`);
      }
      await this.db.run('DELETE FROM chargers WHERE identity = ?', identity);
      logger.info(`Charger deleted for identity: ${identity}`);
    } catch (error) {
      logger.error(`Error in deleteCharger for identity: ${identity}`, error);
      throw error;
    }
  }
}
