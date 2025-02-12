import { IChargerRepository } from '../database';
import { Database } from 'sqlite';
import {Charger} from "../../model/charger";

export class ChargerRepository implements IChargerRepository {
  constructor(private db: Database) {}

  async getCharger(chargerId: string): Promise<Charger | null> {
    const row = await this.db.get('SELECT * FROM chargers WHERE chargerId = ?', chargerId);
    if (!row) {
      return null;
    }
    return new Charger(
      row.chargerId,
      row.userId,
      row.dwellingId,
      row.vendor,
      row.model,
      row.serialNumber,
      row.firmwareVersion,
      row.firstBootNotificationReceived,
      row.lastStatus,
      row.lastStatusTimestamp,
      row.errorCode,
      row.lastHeartbeat,
      row.serviceId
    );
  }

  async addCharger(charger: Charger): Promise<void> {
    await this.db.run('INSERT INTO chargers (chargerId, userId, dwellingId) VALUES (?, ?, ?)',
      charger.chargerId, charger.userId, charger.dwellingId);
  }

  async updateCharger(chargerId: string, updates: Partial<Charger>): Promise<void> {
    const { vendor, model, serialNumber, firmwareVersion, firstBootNotificationReceived } = updates;
    await this.db.run(`
      UPDATE chargers
      SET vendor = ?, model = ?, serialNumber = ?, firmwareVersion = ?, firstBootNotificationReceived = ?
      WHERE chargerId = ?
    `, vendor, model, serialNumber, firmwareVersion, firstBootNotificationReceived, chargerId);
  }

  async getAllChargers(): Promise<Charger[]> {
    const rows = await this.db.all('SELECT * FROM chargers');
    return rows.map(row => new Charger(
      row.chargerId,
      row.userId,
      row.dwellingId,
      row.vendor,
      row.model,
      row.serialNumber,
      row.firmwareVersion,
      row.firstBootNotificationReceived,
      row.lastStatus,
      row.lastStatusTimestamp,
      row.errorCode,
      row.lastHeartbeat,
      row.serviceId
    ));
  }
}
