# ANSWERS — Assignment 2 (Backend)

## 1. What holds the fleet's current state, and why that shape?

A single in-memory `FleetState` (`backend/src/state/fleet-state.ts`) — a
`Map<string, RobotState>` keyed by robot id. Each entry keeps the latest
telemetry plus two clocks: `lastEventTime` (the event's own `t`, used for
ordering) and `lastSeenAt` (backend receive time, internal only). One object
serves both consumers, which is the whole consistency argument: `GET /robots`
(`backend/src/http/robots.ts`) returns `state.snapshot().map(toPublic)`, and
the `/ws` stream (`backend/src/websocket/stream.ts`) sends the same snapshot
on connect and then pushes `toPublic(robot)` for every accepted update via
`state.onUpdate()`. There is deliberately no second store, no cache layer, and
no per-consumer copy — a polling client and a socket client necessarily read
the same object through the same `toPublic()` whitelist mapper, so they cannot
diverge. A `Map` (rather than an array or a database) fits because the brief
asks for *current* state only: 8 robots, O(1) update by id, newest-`t`-wins in
`FleetState.update()`, and no query pattern more complex than "all" or "by id".

## 2. One real tradeoff: MQTT QoS 1 in, fire-and-forget fanout out

Robots reach the backend over MQTT (`fleet/<robot_id>/telemetry`, QoS 1,
`robot-simulator/src/index.ts`), consumed by `createMessageHandler()` in
`backend/src/mqtt/consumer.ts`. QoS 1 gives at-least-once delivery across
reconnects (mqtt.js queues while offline and redelivers), and the duplicate
side of at-least-once is reconciled in exactly one place: `FleetState.update()`
drops anything with `event.t <= lastEventTime`, so redelivered or
late-arriving events can never regress state. The WebSocket side does not
inherit those guarantees — fanout in `websocket/stream.ts` is best-effort per
connected socket, with slow consumers terminated past 256 KB of unsent data
instead of buffering forever. I chose this split because the two links need
different things: ingest must not lose robot reports (hence QoS 1 + dedupe),
while a lagging dashboard client must not be allowed to back-pressure the
server or OOM it (hence drop-the-laggard). The cost is explicit: a client that
connects late, or is terminated for lagging, misses interim updates — mitigated
by the full snapshot sent on every new connection, so any client can always
resync to current truth, just not replay history. The other cost is the broker
itself: Mosquitto is a single, non-persistent hop, so anything published while
the backend is down is gone; accepted for an 8-robot local demo, wrong for
anything where gaps are unacceptable (that would be the history store in Q3).

## 3. What I left out, and what comes next

Cut deliberately: the optional history endpoint (`GET /robots/history/...`),
stale/offline marking for silent robots (the backend keeps last-known state
forever today — absence is not surfaced as a signal), authentication, and
platform pinning (built and tested on x86_64; base images are multi-arch, so
nothing ARM-specific to pin). Given more time, first would be a staleness
sweep over `lastSeenAt` surfacing "no report for N seconds" through the same
`toPublic` shape plus an `onUpdate` push, because Q4/Q5 below show that silent
robots are the least-visible failure in the current design; second the SQLite
history store, since `FleetState.update()` is already the single choke point
where every accepted event could also be appended. Tests (`backend/tests/`)
cover what I found trickiest instead: newest-wins ordering under stale/duplicate
delivery, handler rejection paths, and REST↔WS consistency.
