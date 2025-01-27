import dotenv from "dotenv";

dotenv.config();

const requiredEnvVar = (name) => {
  const value = process.env[name];
  if (!value) {
    throw new Error(`Environment variable ${name} is missing!`);
  }
  return value;
};

const optionalEnvVar = (name, defaultValue) => {
  const value = process.env[name];
  if (!value) {
    console.warn(
      `Environment variable ${name} is not provided. Using default value: ${defaultValue}`,
    );
    return defaultValue;
  }
  return value;
};

const config = () => {
  return {
    nodeEnv: optionalEnvVar("NODE_ENV", "development"),
    logLevel: optionalEnvVar("LOG_LEVEL", "info"),
    port: optionalEnvVar("PORT", 3000),
    host: optionalEnvVar("HOST", "localhost"),
  };
}

export default config;
