import mqtt from "mqtt";
import { loadConfig } from "./config.js";
import { loadEventsByRobot, loadRobots } from "./telemetry.js";

const sleep = (ms: number) => new Promise<void>((resolve) => setTimeout(resolve, ms));

export const topicFor = (robotId: string): string => `fleet/${robotId}/telemetry`;

async function main(): Promise<void> {
  const config = loadConfig();
  const robot = loadRobots(`${config.dataDir}/robots.json`).find(
    (r) => r.robot_id === config.robotId,
  );
  if (!robot) throw new Error(`unknown robot: ${config.robotId}`);

  const events = (loadEventsByRobot(`${config.dataDir}/events.jsonl`).get(robot.robot_id) ?? [])
    .sort((a, b) => a.t - b.t);
  if (events.length === 0) throw new Error(`no events for robot ${robot.robot_id}`);
  console.log(`${robot.robot_id} (${robot.robot_type}): ${events.length} events @ ${config.speed}x`);

  const client = mqtt.connect(config.mqttUrl, { clientId: `sim-${robot.robot_id}` });
  await new Promise<void>((resolve, reject) => {
    client.once("connect", () => resolve());
    client.once("error", reject);
  });
  const topic = topicFor(robot.robot_id);
  console.log(`connected to ${config.mqttUrl}, publishing on ${topic}`);

  let prevT = 0;
  for (const event of events) {
    const waitMs = ((event.t - prevT) * 1000) / config.speed;
    prevT = event.t;
    if (waitMs > 0) await sleep(waitMs);
    client.publish(topic, JSON.stringify(event), { qos: 1 });
  }

  await new Promise<void>((resolve) => client.end(() => resolve()));
  console.log(`${robot.robot_id}: replay done`);
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
