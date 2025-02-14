import dotenv from 'dotenv';

dotenv.config();

interface Config {
  nodeEnv: string;
  logLevel: string;
  port: number;
  host: string;
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

const config: Config = {
  nodeEnv: getEnvVar('NODE_ENV', 'development'),
  logLevel: getEnvVar('LOG_LEVEL', 'info'),
  port: Number(getEnvVar('PORT', '3000')),
  host: getEnvVar('HOST', 'localhost'),
};

export default Object.freeze(config);
