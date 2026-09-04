import { describe, expect, it } from "vitest";
import { loadEventsByRobot, loadRobots, telemetryEventSchema } from "../src/telemetry.js";

const robots = loadRobots("../data/robots.json");
const eventsByRobot = loadEventsByRobot("../data/events.jsonl");

describe("telemetry data", () => {
  it("has 8 robots with unique ids", () => {
    expect(robots).toHaveLength(8);
    expect(new Set(robots.map((r) => r.robot_id)).size).toBe(8);
  });

  it("has events for every robot", () => {
    for (const robot of robots) {
      const events = eventsByRobot.get(robot.robot_id);
      expect(events, robot.robot_id).toBeDefined();
      expect(events!.length).toBeGreaterThan(0);
    }
  });

  it("events are chronologically ordered per robot", () => {
    for (const events of eventsByRobot.values()) {
      for (let i = 1; i < events.length; i++) {
        expect(events[i].t).toBeGreaterThanOrEqual(events[i - 1].t);
      }
    }
  });

  it("rejects malformed events", () => {
    expect(() => telemetryEventSchema.parse({})).toThrow();
    expect(() => telemetryEventSchema.parse({ battery: 150 })).toThrow();
  });
});
