import type { FastifyInstance } from "fastify";
import type { FleetState, RobotState } from "../state/fleet-state.js";

/** Public API shape. lastSeenAt stays internal — this type is the whole contract. */
export interface RobotPublic {
  robot_id: string;
  robot_type: string;
  position: { x: number; y: number };
  battery: number;
  status: string;
  lastEventTime: number;
}

/** Sole internal→public mapping; whitelist construction, nothing to strip. */
export function toPublic(s: RobotState): RobotPublic {
  return {
    robot_id: s.robotId,
    robot_type: s.robotType,
    position: { x: s.x, y: s.y },
    battery: s.battery,
    status: s.status,
    lastEventTime: s.lastEventTime,
  };
}

export function registerRobotRoutes(app: FastifyInstance, state: FleetState): void {
  app.get("/robots", async () => state.snapshot().map(toPublic));

  app.get<{ Params: { robotId: string } }>("/robots/:robotId", async (req, reply) => {
    const robot = state.get((req.params.robotId ?? "").trim());
    if (!robot) {
      return reply
        .code(404)
        .send({ error: "robot not found", robotId: req.params.robotId });
    }
    return toPublic(robot);
  });
}
