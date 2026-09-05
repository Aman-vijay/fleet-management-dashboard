import type { RobotEvent, RobotType } from "../domain/events.js";

export interface RobotState {
  robotId: string;
  robotType: RobotType;
  x: number;
  y: number;
  status: RobotEvent["status"];
  battery: number;
  taskEvent?: RobotEvent["task_event"];
  /** simulation/event time — the only clock used for ordering */
  lastEventTime: number;
  /** backend receive/processing time (ms epoch) */
  lastSeenAt: number;
}

/**
 * In-memory fleet state. Single ordering rule lives here:
 * an event is applied only when event.t > lastEventTime.
 * Consumers (MQTT today, anything tomorrow) never re-implement this.
 */
export class FleetState {
  private robots = new Map<string, RobotState>();
  private listeners = new Set<(robot: RobotState) => void>();

  /** Push-side subscription (WebSocket fanout). Fires only for accepted updates. */
  onUpdate(listener: (robot: RobotState) => void): () => void {
    this.listeners.add(listener);
    return () => {
      this.listeners.delete(listener);
    };
  }

  /** @returns true when the event was newer and applied, false when ignored */
  update(event: RobotEvent, robotType: RobotType, receivedAt: number): boolean {
    const existing = this.robots.get(event.robot_id);
    if (existing && event.t <= existing.lastEventTime) return false;
    const next: RobotState = {
      robotId: event.robot_id,
      robotType,
      x: event.x,
      y: event.y,
      status: event.status,
      battery: event.battery,
      taskEvent: event.task_event,
      lastEventTime: event.t,
      lastSeenAt: receivedAt,
    };
    this.robots.set(event.robot_id, next);
    for (const listener of this.listeners) listener(next);
    return true;
  }

  get(robotId: string): RobotState | undefined {
    return this.robots.get(robotId);
  }

  get size(): number {
    return this.robots.size;
  }

  snapshot(): RobotState[] {
    return [...this.robots.values()].sort((a, b) => (a.robotId < b.robotId ? -1 : 1));
  }
}
