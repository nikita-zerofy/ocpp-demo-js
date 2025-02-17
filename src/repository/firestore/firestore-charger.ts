import {Collection} from 'fireorm';

@Collection()
export class Charger {
  id!: string;
  userId!: string;
  dwellingId!: string;
  serviceId!: string;
  projectId!: string;
  vendor?: string;
  model?: string;
  serialNumber?: string;
  firmwareVersion?: string;
  firstBootNotificationReceived?: boolean;
  lastStatus?: string;
  lastStatusTimestamp?: string;
  errorCode?: string;
  lastHeartbeat?: string;
}
