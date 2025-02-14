import pino from 'pino';
import {createGcpLoggingPinoConfig} from '@google-cloud/pino-logging-gcp-config';
import config from './config';

const isProduction = config.nodeEnv === 'production';
const logLevel = config.logLevel || 'trace';

const logger = isProduction
  ? pino({...createGcpLoggingPinoConfig(), level: logLevel})
  : pino({
      level: logLevel,
      transport: {
        target: 'pino-pretty',
        options: {
          translateTime: 'SYS:standard',
          ignore: 'pid,hostname',
        },
      },
    });

export default logger;
