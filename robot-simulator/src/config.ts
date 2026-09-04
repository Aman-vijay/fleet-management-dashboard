export interface SimConfig {
  robotId: string;
  mqttUrl: string;
  dataDir: string;
  /** replay speed multiplier: 1 = recorded pace, 10 = 10x faster */
  speed: number;
}

export function loadConfig(env: NodeJS.ProcessEnv = process.env): SimConfig {
  const speed = Number(env.REPLAY_SPEED ?? "1");
  if (!Number.isFinite(speed) || speed <= 0) {
    throw new Error(`invalid REPLAY_SPEED: ${env.REPLAY_SPEED}`);
  }
  return {
    robotId: env.ROBOT_ID ?? "r1",
    mqttUrl: env.MQTT_URL ?? "mqtt://localhost:1883",
    dataDir: env.DATA_DIR ?? "../data",
    speed,
  };
}
