import { readFileSync } from "node:fs";
import { z } from "zod";

export const robotSchema = z.object({
  robot_id: z.string().min(1),
  robot_type: z.enum(["picker", "hauler"]),
  start: z.object({ x: z.number(), y: z.number() }),
});
export type Robot = z.infer<typeof robotSchema>;

export const telemetryEventSchema = z.object({
  t: z.number().min(0),
  robot_id: z.string().min(1),
  x: z.number(),
  y: z.number(),
  status: z.enum([
    "idle",
    "active",
    "on_mission",
    "blocked",
    "maintenance",
    "charging",
    "error",
    "offline",
  ]),
  battery: z.number().min(0).max(100),
  task_event: z.enum(["task_started", "task_completed"]).optional(),
});
export type TelemetryEvent = z.infer<typeof telemetryEventSchema>;

export function loadRobots(file: string): Robot[] {
  return z.array(robotSchema).parse(JSON.parse(readFileSync(file, "utf8")));
}

/** Parse events.jsonl and group events by robot_id, preserving per-robot file order. */
export function loadEventsByRobot(file: string): Map<string, TelemetryEvent[]> {
  const byRobot = new Map<string, TelemetryEvent[]>();
  for (const line of readFileSync(file, "utf8").split("\n")) {
    if (!line.trim()) continue;
    const event = telemetryEventSchema.parse(JSON.parse(line));
    const events = byRobot.get(event.robot_id) ?? [];
    events.push(event);
    byRobot.set(event.robot_id, events);
  }
  return byRobot;
}
