import dotenv from 'dotenv';

dotenv.config();

interface Config {
  nodeEnv: string;
  logLevel: string;
  port: number;
  host: string;
  ocppDomain: string;
  ocppUrl: string;
}

const getEnvVar = (name: string, defaultValue?: string | number | boolean): string => {
  const value = process.env[name];
  if (value === undefined || value === '') {
    if (defaultValue !== undefined) {
      console.warn(`Environment variable ${name} is not provided. Using default value: ${defaultValue}`);
      return String(defaultValue);
    }
    throw new Error(`Environment variable ${name} is missing!`);
  }
  return value;
};

const nodeEnv = getEnvVar('NODE_ENV', 'development');
const port = Number(getEnvVar('PORT', '3000'));
const ocppDomain = getEnvVar('OCPP_DOMAIN', 'ocppconnect.net');

const config: Config = {
  nodeEnv,
  logLevel: getEnvVar('LOG_LEVEL', 'info'),
  port,
  host: getEnvVar('HOST', 'localhost'),
  ocppDomain,
  // If we're in development, use ws://localhost:<port>; otherwise use wss://<ocppDomain>
  ocppUrl: nodeEnv === 'development' ? `ws://localhost:${port}` : `wss://${ocppDomain}`,
};

export default Object.freeze(config);
