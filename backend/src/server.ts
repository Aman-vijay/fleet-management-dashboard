import Fastify from "fastify";
import { loadConfig } from "./config.js";
import { loadRobotTypes } from "./domain/events.js";
import { registerRobotRoutes } from "./http/robots.js";
import { startMqttConsumer } from "./mqtt/consumer.js";
import { FleetState } from "./state/fleet-state.js";

async function main(): Promise<void> {
  const config = loadConfig();
  const robotTypes = loadRobotTypes(`${config.dataDir}/robots.json`);
  console.log(`backend: tracking ${robotTypes.size} robots`);

  const state = new FleetState();
  startMqttConsumer({ mqttUrl: config.mqttUrl, state, robotTypes });

  // Routes read the same FleetState the MQTT consumer writes — one source of truth.
  const app = Fastify();
  app.decorate("fleet", state);
  registerRobotRoutes(app, state);
  await app.listen({ port: config.port, host: "0.0.0.0" });
  console.log(`backend: listening on ${config.port}`);

  // Verification hook: log one snapshot when every robot reaches its final event.
  const watch = setInterval(() => {
    const snap = state.snapshot();
    if (snap.length === robotTypes.size && snap.every((r) => r.lastEventTime >= 900)) {
      clearInterval(watch);
      console.log(`backend: fleet complete — ${snap.length}/${robotTypes.size} robots at final state`);
      console.log(JSON.stringify(snap));
    }
  }, 5000);
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
