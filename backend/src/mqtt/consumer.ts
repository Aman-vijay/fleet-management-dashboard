import mqtt, { type MqttClient } from "mqtt";
import { robotEventSchema, type RobotType } from "../domain/events.js";
import type { FleetState } from "../state/fleet-state.js";

export const TELEMETRY_TOPIC = "fleet/+/telemetry";

export interface MessageHandlerDeps {
  state: FleetState;
  robotTypes: Map<string, RobotType>;
  log?: Pick<Console, "warn">;
}

/**
 * Pure message handling: parse, validate, route into FleetState.
 * No sockets here — unit-testable without a broker.
 * Ordering rule is NOT duplicated: FleetState.update() decides newer vs stale.
 */
export function createMessageHandler(deps: MessageHandlerDeps) {
  const log = deps.log ?? console;
  return (topic: string, payload: Buffer): void => {
    let raw: unknown;
    try {
      raw = JSON.parse(payload.toString("utf8"));
    } catch {
      log.warn(`mqtt: ignoring non-JSON payload on ${topic}`);
      return;
    }
    const parsed = robotEventSchema.safeParse(raw);
    if (!parsed.success) {
      log.warn(`mqtt: ignoring invalid event on ${topic}: ${parsed.error.issues[0]?.message}`);
      return;
    }
    const event = parsed.data;
    if (topic.split("/")[1] !== event.robot_id) {
      log.warn(`mqtt: topic/payload robot mismatch on ${topic}`);
      return;
    }
    const robotType = deps.robotTypes.get(event.robot_id);
    if (!robotType) {
      log.warn(`mqtt: unknown robot ${event.robot_id}`);
      return;
    }
    deps.state.update(event, robotType, Date.now());
  };
}

export interface ConsumerOptions {
  mqttUrl: string;
  state: FleetState;
  robotTypes: Map<string, RobotType>;
  log?: Pick<Console, "info" | "warn" | "error">;
}

/**
 * Network wiring only. mqtt.js reconnects on its own (reconnectPeriod default 1s);
 * handlers here just log — a dropped broker must never crash the process.
 */
export function startMqttConsumer(options: ConsumerOptions): MqttClient {
  const log = options.log ?? console;
  const handle = createMessageHandler(options);
  const client = mqtt.connect(options.mqttUrl);
  client.on("connect", () => {
    log.info(`mqtt: connected to ${options.mqttUrl}`);
    client.subscribe(TELEMETRY_TOPIC, { qos: 1 }, (err) => {
      if (err) log.error(`mqtt: subscribe failed: ${err.message}`);
      else log.info(`mqtt: subscribed to ${TELEMETRY_TOPIC}`);
    });
  });
  client.on("message", (topic, payload) => {
    try {
      handle(topic, payload);
    } catch (err) {
      log.warn(`mqtt: handler error on ${topic}: ${(err as Error).message}`);
    }
  });
  client.on("reconnect", () => log.warn("mqtt: reconnecting..."));
  client.on("offline", () => log.warn("mqtt: offline"));
  client.on("error", (err) => log.error(`mqtt: ${err.message}`));
  return client;
}
