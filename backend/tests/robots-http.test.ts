import Fastify from "fastify";
import { afterEach, describe, expect, it } from "vitest";
import type { RobotEvent } from "../src/domain/events.js";
import { registerRobotRoutes, type RobotPublic } from "../src/http/robots.js";
import { FleetState } from "../src/state/fleet-state.js";

const PUBLIC_KEYS = ["robot_id", "robot_type", "position", "battery", "status", "lastEventTime"].sort();

function event(overrides: Partial<RobotEvent> = {}): RobotEvent {
  return {
    t: 10,
    robot_id: "r1",
    x: 580.9,
    y: 29.4,
    status: "active",
    battery: 83.8,
    ...overrides,
  };
}

function setup() {
  const state = new FleetState();
  const app = Fastify();
  registerRobotRoutes(app, state);
  return { state, app };
}

describe("GET /robots", () => {
  const apps: ReturnType<typeof Fastify>[] = [];
  afterEach(async () => {
    await Promise.all(apps.splice(0).map((a) => a.close()));
  });

  it("returns all currently known robots", async () => {
    const { state, app } = setup();
    apps.push(app);
    state.update(event({ robot_id: "r1" }), "picker", 1);
    state.update(event({ robot_id: "r2", status: "idle" }), "hauler", 2);
    const res = await app.inject({ method: "GET", url: "/robots" });
    expect(res.statusCode).toBe(200);
    const body = res.json();
    expect(body).toHaveLength(2);
    expect(body[0]).toEqual({
      robot_id: "r1",
      robot_type: "picker",
      position: { x: 580.9, y: 29.4 },
      battery: 83.8,
      status: "active",
      lastEventTime: 10,
    });
  });

  it("returns [] when state is empty", async () => {
    const { app } = setup();
    apps.push(app);
    const res = await app.inject({ method: "GET", url: "/robots" });
    expect(res.statusCode).toBe(200);
    expect(res.json()).toEqual([]);
  });

  it("reflects updates made after a previous read (no stale copies)", async () => {
    const { state, app } = setup();
    apps.push(app);
    state.update(event({ t: 10 }), "picker", 1);
    expect(resBody(await app.inject({ method: "GET", url: "/robots" }))[0].battery).toBe(83.8);
    state.update(event({ t: 15, battery: 80.1, x: 581.0 }), "picker", 2);
    const latest = resBody(await app.inject({ method: "GET", url: "/robots" }))[0];
    expect(latest.battery).toBe(80.1);
    expect(latest.position).toEqual({ x: 581.0, y: 29.4 });
    expect(latest.lastEventTime).toBe(15);
  });

  it("never exposes lastSeenAt", async () => {
    const { state, app } = setup();
    apps.push(app);
    state.update(event(), "picker", Date.now());
    const body = resBody(await app.inject({ method: "GET", url: "/robots" }));
    expect(Object.keys(body[0]).sort()).toEqual(PUBLIC_KEYS);
    expect(JSON.stringify(body)).not.toContain("lastSeenAt");
  });
});

describe("GET /robots/:robotId", () => {
  const apps: ReturnType<typeof Fastify>[] = [];
  afterEach(async () => {
    await Promise.all(apps.splice(0).map((a) => a.close()));
  });

  it("returns the correct robot", async () => {
    const { state, app } = setup();
    apps.push(app);
    state.update(event({ robot_id: "r3", status: "idle", battery: 47.1 }), "picker", 1);
    const res = await app.inject({ method: "GET", url: "/robots/r3" });
    expect(res.statusCode).toBe(200);
    expect(res.json()).toEqual({
      robot_id: "r3",
      robot_type: "picker",
      position: { x: 580.9, y: 29.4 },
      battery: 47.1,
      status: "idle",
      lastEventTime: 10,
    });
  });

  it("returns 404 with an error body for unknown robots", async () => {
    const { app } = setup();
    apps.push(app);
    const res = await app.inject({ method: "GET", url: "/robots/r9" });
    expect(res.statusCode).toBe(404);
    expect(res.json()).toEqual({ error: "robot not found", robotId: "r9" });
  });
});

function resBody(res: { json(): unknown }): RobotPublic[] {
  return res.json() as RobotPublic[];
}
