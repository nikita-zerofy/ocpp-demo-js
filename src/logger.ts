import pino, { Logger } from 'pino';
import config from './config';

const logLevel = config.logLevel || 'trace';

const logger: Logger = pino({
  level: logLevel,
  transport: {
    target: 'pino-pretty',
    options: {
      translateTime: 'SYS:standard',
      ignore: 'pid,hostname'
    }
  }
});

export default logger;
