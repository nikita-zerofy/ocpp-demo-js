import DBMigrate from 'db-migrate';
import logger from "./src/logger.js";

export async function runMigrations() {
  const dbm = DBMigrate.getInstance(true, {config: 'database.json'});
  try {
    await dbm.up();
    logger.info('Migrations applied successfully.');
  } catch (err) {
    logger.error('Migration error:', err);
    process.exit(1);
  }
}
