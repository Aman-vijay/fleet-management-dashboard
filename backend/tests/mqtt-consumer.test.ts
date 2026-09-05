import { describe, expect, it, vi } from "vitest";
import { loadRobotTypes } from "../src/domain/events.js";
import { createMessageHandler } from "../src/mqtt/consumer.js";
import { FleetState } from "../src/state/fleet-state.js";

const robotTypes = loadRobotTypes("../data/robots.json");

function setup() {
  const state = new FleetState();
  const log = { warn: vi.fn() };
  const handle = createMessageHandler({ state, robotTypes, log });
  return { state, log, handle };
}

const valid = {
  t: 10,
  robot_id: "r1",
  x: 580.9,
  y: 29.4,
  status: "active",
  battery: 83.8,
};

describe("mqtt message handler", () => {
  it("passes a valid event into FleetState", () => {
    const { state, log, handle } = setup();
    handle("fleet/r1/telemetry", Buffer.from(JSON.stringify(valid)));
    const robot = state.get("r1");
    expect(robot).toMatchObject({
      robotId: "r1",
      robotType: "picker",
      x: 580.9,
      status: "active",
      lastEventTime: 10,
    });
    expect(robot!.lastSeenAt).toBeLessThanOrEqual(Date.now());
    expect(log.warn).not.toHaveBeenCalled();
  });

  it("rejects invalid payloads without crashing or updating state", () => {
    const { state, log, handle } = setup();
    handle("fleet/r1/telemetry", Buffer.from("not json{"));
    handle("fleet/r1/telemetry", Buffer.from(JSON.stringify({ t: -1, battery: 150 })));
    expect(state.size).toBe(0);
    expect(log.warn).toHaveBeenCalledTimes(2);
  });

  it("handles an unknown robot id safely", () => {
    const { state, log, handle } = setup();
    handle(
      "fleet/r9/telemetry",
      Buffer.from(JSON.stringify({ ...valid, robot_id: "r9" })),
    );
    expect(state.size).toBe(0);
    expect(log.warn).toHaveBeenCalledTimes(1);
  });

  it("rejects topic/payload robot mismatch", () => {
    const { state, handle } = setup();
    handle("fleet/r2/telemetry", Buffer.from(JSON.stringify(valid)));
    expect(state.size).toBe(0);
  });

  it("never lets an older event overwrite newer state", () => {
    const { state, handle } = setup();
    const topic = "fleet/r1/telemetry";
    handle(topic, Buffer.from(JSON.stringify({ ...valid, t: 20 })));
    handle(topic, Buffer.from(JSON.stringify({ ...valid, t: 10, battery: 0 })));
    handle(topic, Buffer.from(JSON.stringify({ ...valid, t: 20, battery: 0 })));
    const robot = state.get("r1");
    expect(robot!.lastEventTime).toBe(20);
    expect(robot!.battery).toBe(83.8);
  });
});
