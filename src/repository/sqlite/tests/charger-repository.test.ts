import sqlite3 from 'sqlite3';
import {open, Database} from 'sqlite';
import {SqliteChargerRepository} from '../sqlite-charger-repository';
import {Charger} from '../../../model/charger';

describe('SqliteChargerRepository', () => {
  let db: Database;
  let repository: SqliteChargerRepository;

  beforeAll(async () => {
    db = await open({
      filename: ':memory:',
      driver: sqlite3.Database,
    });

    await db.exec(`
        CREATE TABLE chargers
        (
            identity                      TEXT PRIMARY KEY,
            userId                        TEXT,
            dwellingId                    TEXT,
            serviceId                     TEXT,
            projectId                     TEXT,
            vendor                        TEXT,
            model                         TEXT,
            serialNumber                  TEXT,
            firmwareVersion               TEXT,
            firstBootNotificationReceived BOOLEAN,
            lastStatus                    TEXT,
            lastStatusTimestamp           TEXT,
            errorCode                     INTEGER,
            lastHeartbeat                 TEXT
        );
    `);

    repository = new SqliteChargerRepository(db);
  });

  afterAll(async () => {
    await db.close();
  });

  it('should save and retrieve a Charger with all fields', async () => {
    const testCharger = new Charger(
      'test-identity',
      'test-user',
      'test-dwelling',
      'test-service',
      'test-project',
      'TestVendor',
      'TestModel',
      'TestSerial',
      '1.0.0',
      true,                         // firstBootNotificationReceived
      'Available',                     // lastStatus
      '2025-01-01T00:00:00Z',
      "null",                            // errorCode
      '2025-01-01T00:00:00Z'
    );

    await repository.addCharger(testCharger);

    await repository.updateCharger(testCharger.identity, {
      vendor: testCharger.vendor,
      model: testCharger.model,
      serialNumber: testCharger.serialNumber,
      firmwareVersion: testCharger.firmwareVersion,
      firstBootNotificationReceived: testCharger.firstBootNotificationReceived,
    });

    const retrievedCharger = await repository.getCharger(testCharger.identity);

    expect(retrievedCharger).not.toBeNull();
    expect(retrievedCharger!.identity).toBe(testCharger.identity);
    expect(retrievedCharger!.userId).toBe(testCharger.userId);
    expect(retrievedCharger!.dwellingId).toBe(testCharger.dwellingId);
    expect(retrievedCharger!.serviceId).toBe(testCharger.serviceId);
    expect(retrievedCharger!.projectId).toBe(testCharger.projectId);
    expect(retrievedCharger!.vendor).toBe(testCharger.vendor);
    expect(retrievedCharger!.model).toBe(testCharger.model);
    expect(retrievedCharger!.serialNumber).toBe(testCharger.serialNumber);
    expect(retrievedCharger!.firmwareVersion).toBe(testCharger.firmwareVersion);
    expect(retrievedCharger!.firstBootNotificationReceived).toBe(1);
    expect(retrievedCharger!.lastStatus).toBeNull();
    expect(retrievedCharger!.lastStatusTimestamp).toBeNull();
    expect(retrievedCharger!.errorCode).toBeNull();
    expect(retrievedCharger!.lastHeartbeat).toBeNull();
  });
});
