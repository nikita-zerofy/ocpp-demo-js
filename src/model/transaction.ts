export class Transaction {
  constructor(
    public transactionId: string,
    public identity: string,
    public idTag: string,
    public meterStart: number,
    public meterEnd?: number | null,
    public status?: string,
    public startTimestamp?: string,
    public stopTimestamp?: string | null
  ) {
    this.transactionId = transactionId;
    this.identity = identity;
    this.idTag = idTag;
    this.meterStart = meterStart;
    this.status = status;
    this.startTimestamp = startTimestamp;
  }
}
