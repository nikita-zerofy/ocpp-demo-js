import {BaseFirestoreRepository} from 'fireorm';
import {ChargerRepository} from '../database';
import {Charger} from './firestore-charger';
import logger from '../../logger';

export class FireormChargerRepository implements ChargerRepository {
  constructor(private repository: BaseFirestoreRepository<Charger>) {
    logger.info('FireormChargerRepository instantiated.');
  }

  async getCharger(identity: string): Promise<Charger | null> {
    logger.info(`FireormChargerRepository: Getting charger with identity: ${identity}`);
    try {
      const charger = await this.repository.findById(identity);
      return charger;
    } catch (error: any) {
      // Fireorm's findById will throw an error if the document doesn't exist.
      if (error.message && error.message.includes('No entity with id')) {
        logger.info(`No charger found for identity: ${identity}`);
        return null;
      }
      logger.error(`Error in getCharger for identity: ${identity}`, error);
      throw error;
    }
  }

  async addCharger(charger: Charger): Promise<void> {
    logger.info(`FireormChargerRepository: Adding charger with identity: ${charger.id}`);
    try {
      // Create the document. Fireorm will use charger.id as the document ID.
      await this.repository.create(charger);
      logger.info(`Charger added with identity: ${charger.id}`);
    } catch (error) {
      logger.error(`Error in addCharger for identity: ${charger.id}`, error);
      throw error;
    }
  }

  async updateCharger(identity: string, updates: Charger): Promise<void> {
    logger.info(`FireormChargerRepository: Updating charger with identity: ${identity}`);
    try {
      // Retrieve existing document.
      const existing = await this.repository.findById(identity);
      // Merge updates (you might want to use a more sophisticated merge if needed).
      const updated = {...existing, ...updates};
      await this.repository.update(updated);
      logger.info(`Charger updated for identity: ${identity}`);
    } catch (error) {
      logger.error(`Error in updateCharger for identity: ${identity}`, error);
      throw error;
    }
  }

  async getAllChargers(): Promise<Charger[]> {
    logger.info('FireormChargerRepository: Retrieving all chargers');
    try {
      const chargers = await this.repository.find();
      logger.info(`Retrieved ${chargers.length} charger(s) from Firestore`);
      return chargers;
    } catch (error) {
      logger.error('Error in getAllChargers', error);
      throw error;
    }
  }

  async deleteCharger(identity: string): Promise<void> {
    logger.info(`FireormChargerRepository: Deleting charger with identity: ${identity}`);
    try {
      await this.repository.delete(identity);
      logger.info(`Charger deleted for identity: ${identity}`);
    } catch (error) {
      logger.error(`Error in deleteCharger for identity: ${identity}`, error);
      throw error;
    }
  }
}
