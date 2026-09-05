export interface BackendConfig {
  mqttUrl: string;
  dataDir: string;
  port: number;
}

export function loadConfig(env: NodeJS.ProcessEnv = process.env): BackendConfig {
  const port = Number(env.PORT ?? "3000");
  if (!Number.isInteger(port) || port <= 0 || port > 65535) {
    throw new Error(`invalid PORT: ${env.PORT}`);
  }
  return {
    mqttUrl: env.MQTT_URL ?? "mqtt://localhost:1883",
    dataDir: env.DATA_DIR ?? "../data",
    port,
  };
}
