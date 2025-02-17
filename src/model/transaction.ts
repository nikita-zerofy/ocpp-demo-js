export type Transaction = {
  transactionId: number | null;
  identity: string;
  idTag: string;
  meterStart: number;
  meterEnd?: number | null;
  status?: string;
  startTimestamp?: string;
  stopTimestamp?: string | null;
}
