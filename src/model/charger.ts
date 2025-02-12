export class Charger {
  constructor(
    public chargerId: string,
    public userId: string,
    public dwellingId: string,
    public vendor?: string,
    public model?: string,
    public serialNumber?: string,
    public firmwareVersion?: string,
    public firstBootNotificationReceived?: boolean,
    public lastStatus?: string,
    public lastStatusTimestamp?: string,
    public errorCode?: string,
    public lastHeartbeat?: string,
    public serviceId?: string
  ) {}
}
