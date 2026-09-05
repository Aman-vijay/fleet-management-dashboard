import Fastify, { type FastifyInstance } from "fastify";
import websocket from "@fastify/websocket";
import { afterEach, describe, expect, it } from "vitest";
import type { RobotEvent } from "../src/domain/events.js";
import { registerRobotRoutes } from "../src/http/robots.js";
import { FleetState } from "../src/state/fleet-state.js";
import { registerRobotStream, type SnapshotMessage, type UpdateMessage } from "../src/websocket/stream.js";

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

interface Served {
  app: FastifyInstance;
  state: FleetState;
  port: number;
}

async function serve(): Promise<Served> {
  const state = new FleetState();
  const app = Fastify();
  await app.register(websocket);
  registerRobotRoutes(app, state);
  registerRobotStream(app, state);
  await app.listen({ port: 0, host: "127.0.0.1" });
  const address = app.server.address();
  if (!address || typeof address === "string") throw new Error("no listen address");
  return { app, state, port: address.port };
}

function collect(ws: WebSocket, count: number, timeoutMs = 5000): Promise<unknown[]> {
  return new Promise((resolve, reject) => {
    const out: unknown[] = [];
    const timer = setTimeout(() => reject(new Error(`timeout waiting for ${count} ws messages`)), timeoutMs);
    ws.addEventListener("message", (e) => {
      out.push(JSON.parse(String(e.data)));
      if (out.length === count) {
        clearTimeout(timer);
        resolve(out);
      }
    });
  });
}

describe("GET /ws", () => {
  const closers: (() => Promise<void>)[] = [];
  afterEach(async () => {
    await Promise.all(closers.splice(0).map((c) => c()));
  });

  async function connect(port: number): Promise<{ ws: WebSocket; first: Promise<unknown[]> }> {
    const ws = new WebSocket(`ws://127.0.0.1:${port}/ws`);
    const first = collect(ws, 1);
    closers.push(async () => {
      ws.close();
      await new Promise((r) => setTimeout(r, 50));
    });
    await new Promise<void>((resolve, reject) => {
      ws.addEventListener("open", () => resolve(), { once: true });
      ws.addEventListener("error", () => reject(new Error("ws connect failed")), { once: true });
    });
    return { ws, first };
  }

  it("sends the current fleet as a snapshot on connect", async () => {
    const { app, state, port } = await serve();
    closers.push(() => app.close());
    state.update(event({ robot_id: "r1" }), "picker", 1);
    state.update(event({ robot_id: "r2", status: "idle" }), "hauler", 2);
    const { first } = await connect(port);
    const [snapshot] = (await first) as [SnapshotMessage];
    expect(snapshot.type).toBe("snapshot");
    expect(snapshot.robots).toHaveLength(2);
    expect(snapshot.robots[0]).toEqual({
      robot_id: "r1",
      robot_type: "picker",
      position: { x: 580.9, y: 29.4 },
      battery: 83.8,
      status: "active",
      lastEventTime: 10,
    });
  });

  it("pushes accepted updates to connected clients", async () => {
    const { app, state, port } = await serve();
    closers.push(() => app.close());
    state.update(event({ robot_id: "r1" }), "picker", 1);
    const { ws, first } = await connect(port);
    await first;
    const next = collect(ws, 1);
    state.update(event({ robot_id: "r1", t: 15, battery: 80.1 }), "picker", 2);
    const [update] = (await next) as [UpdateMessage];
    expect(update.type).toBe("update");
    expect(update.robot).toMatchObject({ robot_id: "r1", battery: 80.1, lastEventTime: 15 });
  });

  it("pushes nothing for stale updates", async () => {
    const { app, state, port } = await serve();
    closers.push(() => app.close());
    state.update(event({ robot_id: "r1", t: 20 }), "picker", 1);
    const { ws, first } = await connect(port);
    await first;
    let received = 0;
    ws.addEventListener("message", () => {
      received += 1;
    });
    state.update(event({ robot_id: "r1", t: 10, battery: 0 }), "picker", 2);
    await new Promise((r) => setTimeout(r, 300));
    expect(received).toBe(0);
  });

  it("stays consistent with GET /robots (same state, same shape)", async () => {
    const { app, state, port } = await serve();
    closers.push(() => app.close());
    state.update(event({ robot_id: "r1" }), "picker", 1);
    state.update(event({ robot_id: "r2", status: "idle" }), "hauler", 2);
    const { first } = await connect(port);
    const [snapshot] = (await first) as [SnapshotMessage];
    const res = await app.inject({ method: "GET", url: "/robots" });
    expect(res.statusCode).toBe(200);
    expect(res.json()).toEqual(snapshot.robots);
  });
});
