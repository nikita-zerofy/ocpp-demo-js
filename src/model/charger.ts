export class Charger {
  constructor(
    public id: string,
    public userId: string,
    public dwellingId: string,
    public serviceId: string,
    public projectId: string,
    public vendor?: string,
    public model?: string,
    public serialNumber?: string,
    public firmwareVersion?: string,
    public firstBootNotificationReceived?: boolean,
    public lastStatus?: string,
    public lastStatusTimestamp?: string,
    public errorCode?: string,
    public lastHeartbeat?: string
  ) {}
}
