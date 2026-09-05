import { readFileSync } from "node:fs";
import { z } from "zod";

export const robotEventSchema = z.object({
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
export type RobotEvent = z.infer<typeof robotEventSchema>;

export const robotInfoSchema = z.object({
  robot_id: z.string().min(1),
  robot_type: z.enum(["picker", "hauler"]),
});
export type RobotType = z.infer<typeof robotInfoSchema>["robot_type"];

/** robots.json is the single source of truth for robot type; never duplicated in event payloads. */
export function loadRobotTypes(file: string): Map<string, RobotType> {
  const robots = z.array(robotInfoSchema).parse(JSON.parse(readFileSync(file, "utf8")));
  return new Map(robots.map((r) => [r.robot_id, r.robot_type]));
}
