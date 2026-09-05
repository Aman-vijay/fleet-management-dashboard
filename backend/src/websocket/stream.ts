import type { FastifyInstance } from "fastify";
import type { WebSocket } from "ws";
import { toPublic, type RobotPublic } from "../http/robots.js";
import type { FleetState, RobotState } from "../state/fleet-state.js";

export interface SnapshotMessage {
  type: "snapshot";
  robots: RobotPublic[];
}

export interface UpdateMessage {
  type: "update";
  robot: RobotPublic;
}

/** Kill lagging sockets past this much unsent data instead of buffering forever. */
const MAX_BUFFERED_BYTES = 256 * 1024;

export function registerRobotStream(app: FastifyInstance, state: FleetState): void {
  const sockets = new Set<WebSocket>();

  const broadcast = (robot: RobotState): void => {
    const message = JSON.stringify({ type: "update", robot: toPublic(robot) } satisfies UpdateMessage);
    for (const socket of sockets) {
      if (socket.readyState !== socket.OPEN) continue;
      if (socket.bufferedAmount > MAX_BUFFERED_BYTES) {
        socket.terminate();
        continue;
      }
      socket.send(message);
    }
  };

  const unsubscribe = state.onUpdate(broadcast);
  app.addHook("onClose", (_instance, done) => {
    unsubscribe();
    done();
  });

  app.get("/ws", { websocket: true }, (socket: WebSocket) => {
    sockets.add(socket);
    socket.send(JSON.stringify({ type: "snapshot", robots: state.snapshot().map(toPublic) } satisfies SnapshotMessage));
    const drop = (): void => {
      sockets.delete(socket);
    };
    socket.on("close", drop);
    socket.on("error", drop);
  });
}
