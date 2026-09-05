# SYSTEM_DESIGN

Answers refer to the system as built. File paths are relative to the repo root.

## 1. Adding a feature later — e.g. a "needs attention" robot list

No rework needed; the seams already exist. Say the operator wants robots with
low battery or `error`/`blocked` status highlighted. The read path is a new
route next to `registerRobotRoutes()` in `backend/src/http/robots.ts`, derived
from `FleetState.get()`/`snapshot()` — a pure filter over current state, no new
storage. The push path is a second `state.onUpdate()` listener (the same hook
`websocket/stream.ts` uses) that pushes an alert message when an accepted
update crosses a threshold. The write path needs nothing: `FleetState.update()`
in `backend/src/state/fleet-state.ts` stays the single choke point, and the
MQTT consumer needs no changes. The feature would land as one new module plus
tests, touching no existing behavior — which is the payoff of keeping state,
ingest, and serving as three separate units with `FleetState` in the middle.

## 2. What happens when robot goes from 8 robots to 500

The first thing to break is the simulator topology, not the backend. Five
hundred near-identical compose services in `docker-compose.yml` becomes
unmanageable long before anything technical fails; that file's one-service-per-
robot structure was chosen for 8 robots and specliteral process isolation, and
at 500 it would be replaced by one container image parameterized by `ROBOT_ID`
with a small launcher (or compose `--scale` on a single robot service). The
backend itself degrades gracefully: `FleetState` is a `Map` (O(1) updates,
trivial at 500 entries), per-update fanout in `websocket/stream.ts` is O(robots
× sockets) of ~200-byte messages, and Mosquitto handles ~100 msgs/s without
noticing. The actual scaling pain would be per-connection snapshot cost —
every new `/ws` client serializes all 500 robots — so the second change would
be paginated or delta-only snapshots. Nothing in `FleetState.update()` or the
handler needs to change; the ordering and validation logic is per-event and
robot-count agnostic.

## 3. Limited bandwidth between robots and backend

Three changes, in order of payoff, all landing in `robot-simulator/src/` and
`backend/src/domain/events.ts` together (schema and publisher must stay in
lockstep): first, deadband publishing — only send when position moved more
than ε or battery/status changed, instead of every 5 seconds regardless; most
of the current 1,448 events are near-repeats. Second, split delivery classes:
positions at QoS 0 (a dropped position is superseded 5 seconds later anyway)
and status transitions at QoS 1 (rare, and the ones the operator acts on) —
today everything rides QoS 1 in `robot-simulator/src/index.ts`. Third, shrink
the payload: short field names or a binary encoding instead of verbose JSON,
since field names currently dominate message size. What would *not* change is
`FleetState.update()` — newest-`t`-wins is agnostic to cadence, and sparser
updates only make the per-event ordering cheaper. The WS side already has its
bandwidth answer: lagging sockets are terminated past 256 KB unsent
(`websocket/stream.ts`), so constrained *clients* degrade by reconnecting to a
fresh snapshot rather than accumulating backlog.

## 4. A robot goes down mid-task and stops responding

Today the rest of the system does nothing special ,and that is a known,
documented gap, not an oversight: `FleetState` keeps the robot's last-known
state with its `lastEventTime` frozen, and both REST and WS keep serving it
indistinguishably from live data. The feed itself cannot be the detector,
because absence of messages is not a message (note the feed's own `offline`
status means "the robot *reported* offline" — different from silence). Finding
out requires a staleness sweep: a small watcher comparing `Date.now()` against
each entry's `lastSeenAt` and surfacing "no report for N seconds", which would
land as a new module reading `FleetState` (never inside the MQTT hot path),
surfaced through the existing `toPublic` shape and an `onUpdate` push. What the
system *should* do about it is a product call the brief deliberately leaves
open (status semantics are undefined): at minimum, visually distinguish
stale-but-last-known from live so the operator never mistakes a frozen robot
for a stationary one; never invent telemetry for it. Chosen threshold and
surfacing would be defended the same way current status handling is as an
explicit operator-facing decision, not a protocol inference.

## 5. Slow or unreliable robot↔backend link: late, out-of-order, or missing updates

During the gap, consumers see last-known state: REST keeps returning the frozen
entry, WS pushes nothing new — stale, but never wrong or contradictory, because
both read the same `FleetState`. Three mechanisms cover the three failure
shapes, all already in the code. Late duplicates from QoS 1 redelivery
(mqtt.js reconnects and resubscribes on its own in `mqtt/consumer.ts`,
`reconnectPeriod` default) are dropped by the `event.t <= lastEventTime` guard
in `FleetState.update()` (`backend/src/state/fleet-state.ts`) — at-least-once
delivery plus idempotent-by-`t` application. Genuinely out-of-order arrivals
are dropped the same way; only genuinely newer readings advance state.
Recovery needs no catch-up protocol for *current* state: publishers emit full
readings every tick, so the first post-recovery message converges the robot to
truth immediately. What is lost forever is the interim history — accepted and
documented, since there is no history store (see ANSWERS Q3). The one case
that still bites is messages published while the *backend* is down (as opposed
to the link flapping): with no retained messages and no persistent broker
log, they are gone, and the backend resyncs only from the next live tick.
