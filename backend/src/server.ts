import Fastify from "fastify";
import { loadConfig } from "./config.js";
import { loadRobotTypes } from "./domain/events.js";
import { startMqttConsumer } from "./mqtt/consumer.js";
import { FleetState } from "./state/fleet-state.js";

async function main(): Promise<void> {
  const config = loadConfig();
  const robotTypes = loadRobotTypes(`${config.dataDir}/robots.json`);
  console.log(`backend: tracking ${robotTypes.size} robots`);

  const state = new FleetState();
  startMqttConsumer({ mqttUrl: config.mqttUrl, state, robotTypes });

  // REST + WebSocket land in Phase 3; Fastify listens now so the service is up.
  const app = Fastify();
  app.decorate("fleet", state);
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
