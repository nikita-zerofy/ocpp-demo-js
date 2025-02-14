import pino, { Logger } from 'pino';
import { createGcpLoggingPinoConfig } from '@google-cloud/pino-logging-gcp-config';
import config from './config';

const isProduction = config.nodeEnv === 'production';
const logLevel = config.logLevel || 'trace';

let logger: Logger;

if (isProduction) {
  logger = pino({ ...createGcpLoggingPinoConfig(), level: logLevel });
} else {
  logger = pino({
    level: logLevel,
    transport: {
      target: 'pino-pretty',
      options: {
        translateTime: 'SYS:standard',
        ignore: 'pid,hostname',
      },
    },
  });
}

export default logger;
