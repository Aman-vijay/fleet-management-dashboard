# Fleet Management Dashboard — Assignment 2 (Backend)

I implemented the backend for a fleet of 8 simulated robots.

The backend consumes robot telemetry over MQTT, maintains the current state of
the fleet in memory, and exposes that same state through REST polling and a
WebSocket stream. Everything runs through Docker Compose.

## Run it

Prerequisites: Docker (recent) and Node.js 22+ for local scripts.

```powershell
npm install

docker compose up --build
```

This starts the complete system:

- Mosquitto MQTT broker
- Backend on :3000
- 8 robot simulator services (robot-r1 through robot-r8)

Each robot simulator replays its recorded events from
`data/events.jsonl` in order.

The Compose startup order is intentional. The broker becomes healthy first,
then the backend starts and subscribes to the telemetry topic, and only then
do the robot simulators start publishing. This avoids losing the beginning of
the replay because the backend had not subscribed yet.

`REPLAY_SPEED` can be used to speed up the recorded 5-second event cadence:

```powershell
$env:REPLAY_SPEED="60"
docker compose up --build
```

At 60x, the complete replay takes roughly 15 seconds.

For local development:

```powershell
npm run dev --workspace backend
```

This requires an MQTT broker on localhost:1883. For example:

```powershell
docker compose up mosquitto
```

To run a single robot simulator locally:

```powershell
$env:ROBOT_ID="r3"
npm run dev --workspace robot-simulator
```

Build and test everything with:

```powershell
npm run build --workspaces
npm run test --workspaces
```

## Try it

Once the Compose stack is running:

```powershell
curl http://localhost:3000/robots
```

Returns the current state of all robots.

```powershell
curl http://localhost:3000/robots/r3
```

Returns the current state of a single robot.

```powershell
curl http://localhost:3000/robots/r9
```

Returns a 404 because r9 is not part of the configured fleet.

For the WebSocket stream:

```powershell
node -e "const w=new WebSocket('ws://localhost:3000/ws');w.onmessage=e=>console.log(e.data.slice(0,160))"
```

A WebSocket client first receives a complete snapshot of the current fleet and
then receives incremental updates as new telemetry is accepted.

## Architecture

```text
8 Robot Simulators
        |
        | MQTT / QoS 1
        v
   Mosquitto Broker
        |
        v
   MQTT Consumer
   parse -> validate
        |
        v
    FleetState
   Map<robotId>
      /     \
     /       \
  REST    WebSocket
           snapshot +
       incremental updates
```

I kept FleetState as the single source of truth.

The MQTT consumer is responsible for receiving and validating telemetry. It
does not contain the ordering logic. After validation, it passes the event to
FleetState.update().

REST and WebSocket both read from that same state, which means they cannot
accidentally expose two different representations of the current fleet.

## How the data flows

`robots.json` defines the robot roster and robot types.

`events.jsonl` contains the recorded telemetry events for the robots. The
simulator splits these events by robot and runs one publisher per robot.

Each simulator publishes to:

```text
fleet/<robot_id>/telemetry
```

using MQTT QoS 1.

On the backend, each message goes through:

```text
MQTT message
    ↓
JSON parse
    ↓
Zod validation
    ↓
topic robot_id == payload robot_id
    ↓
robot type lookup from robots.json
    ↓
FleetState.update()
```

Invalid messages are ignored safely instead of being allowed to corrupt the
current fleet state.

## FleetState and event ordering

The backend stores the current state in:

```text
Map<robotId, RobotState>
```

For each robot, I only accept an event when its simulation timestamp t is
newer than the currently stored event.

For example:

```text
current t = 500
incoming t = 480  -> ignored
incoming t = 500  -> ignored
incoming t = 510  -> accepted
```

This gives me a simple newest-t-wins rule.

This rule also makes duplicate or late MQTT deliveries safe at the state
boundary. MQTT QoS 1 provides at-least-once delivery semantics; it does not
itself guarantee deduplication.

I also keep two different timestamps:

- lastEventTime — the timestamp from the robot's telemetry.
- lastSeenAt — when the backend actually received the event.

lastSeenAt is currently kept internal and can be used later for detecting
stale robots.

## REST API

I exposed two REST endpoints:

```text
GET /robots
GET /robots/:robotId
```

Both read directly from FleetState.

The API exposes only the fields intended for consumers. I use a
toPublic() mapper rather than returning the internal state object directly.

The current public shape is:

```text
{
  robot_id,
  robot_type,
  position,
  battery,
  status,
  lastEventTime
}
```

lastSeenAt remains internal because it represents backend reception time
rather than robot telemetry.

## WebSocket

The WebSocket endpoint is:

```text
GET /ws
```

When a client connects, it receives:

```json
{
  "type": "snapshot",
  "robots": [...]
}
```

After that, every accepted FleetState update produces:

```json
{
  "type": "update",
  "robot": {...}
}
```

I deliberately send only the changed robot for incremental updates instead of
broadcasting the complete fleet on every event.

If a client disconnects and reconnects, it receives a fresh snapshot of the
current state. I do not replay every update that happened while it was
disconnected.

For slow WebSocket consumers, I terminate sockets once their unsent data grows
past 256 KB. This prevents a slow client from creating an unbounded memory
buffer or applying back-pressure to the rest of the system.

## Reliability and failure handling

There are a few failure cases I explicitly considered.

**Robot publishes duplicate or late events**

FleetState compares the incoming t with the stored lastEventTime.
Older or equal events are ignored.

**MQTT connection drops**

The MQTT client reconnects automatically. With the current in-memory design,
events published while the backend is disconnected may be missed.

I accepted this tradeoff because the required API serves current state rather
than a durable event history.

A production version could add persistent sessions, buffering, or a durable
event/history store.

**WebSocket connection drops**

A reconnecting client gets a fresh snapshot from FleetState.

This means the client can recover its current state without requiring the
backend to retain and replay every missed WebSocket message.

**WebSocket client is too slow**

The backend does not allow an individual client's unsent buffer to grow
indefinitely. A client that exceeds the 256 KB threshold is terminated and can
reconnect to receive a fresh snapshot.

**Missing telemetry events**

The current implementation intentionally stores only the latest state for
each robot.

Therefore, if the backend receives t=500 and later t=520, it cannot know
whether t=505 was actually missed.

Detecting missing events would require additional information such as sequence
numbers or persisted event history.

## Project layout

```text
backend/
  src/
    mqtt/consumer.ts
      MQTT subscription and telemetry validation

    state/fleet-state.ts
      Single source of truth for current robot state

    http/robots.ts
      REST endpoints and public response mapping

    websocket/stream.ts
      Snapshot + incremental WebSocket updates

robot-simulator/
  src/
    One publisher process per robot

data/
  robots.json
    Robot roster and robot types

  events.jsonl
    Recorded robot telemetry
```

## Design decisions

The main decisions I made were:

**MQTT**

I chose MQTT because the assignment calls for a producer/consumer model and
robot telemetry maps naturally to publish/subscribe communication. The broker
also keeps the robot simulators decoupled from the backend.

**In-memory FleetState**

I did not introduce PostgreSQL, Redis, Kafka, or another persistence layer for
the required implementation because the core requirement is serving the
current fleet state. An in-memory Map keeps the implementation small and
makes the single source of truth explicit.

**MQTT QoS 1**

I use QoS 1 for at-least-once delivery. Because duplicate delivery is possible,
the FleetState newest-t-wins rule makes repeated or late events harmless to
the current state.

**WebSocket snapshot + incremental updates**

A snapshot on connection gives the client a known current state. After that,
only changed robots are sent. On reconnect, the client gets another snapshot
instead of requiring the backend to maintain a replay buffer.

**8 independent simulator services**

Each robot runs as its own Compose service. This makes the producer side closer
to the real-world model of independent robots and also lets me exercise
concurrent publishing.

## Verification

I verified the implementation with:

- Strict TypeScript compilation for both workspaces.
- Full automated test suite passing (16 backend + 4 simulator tests).
- Docker Compose configuration validation.
- End-to-end Compose runs with all 8 robot publishers.
- Final t=900 state cross-checked against the supplied events.jsonl.
- REST and WebSocket response shapes checked for consistency.
- Stale and equal-timestamp events verified to leave FleetState unchanged.
- WebSocket updates verified to occur only for accepted state changes.

## AI delegation notes

I used AI tooling (OpenCode with the Muse Spark model) for 
implementation assistance.

It handled the initial project/bootstrap scaffolding, the robot simulator,
MQTT ingestion,automated tests, and first
drafts of ANSWERS.md, SYSTEM_DESIGN.md, and this README.

The architecture,REST and Websockets implementations, tradeoffs, and scope decisions were made and reviewed by me.
In particular, I chose MQTT as the robot transport, the producer/consumer
architecture, eight independent Compose robot services, in-memory
FleetState, newest-t-wins ordering, QoS 1, and the snapshot-plus-incremental
WebSocket protocol.

I verified the implementation through strict TypeScript builds, automated
tests, Docker Compose runs, and end-to-end telemetry checks against the
supplied source data. I also reviewed the implementation file by file so I can
explain the submitted behavior and design decisions.

## What I cut, and what's next

To keep the implementation focused on the required functionality, I did not
implement:

- Robot history persistence and the optional history endpoint.
- Automatic stale/offline status marking.
- Authentication/authorization.
- ARM platform pinning.

If I continued the implementation, I would first add staleness detection using
lastSeenAt, because a robot can stop sending telemetry while its last
reported status still looks healthy.

After that, I would add a persistent history store at the FleetState.update()
boundary. That would provide historical queries and also make recovery from
missed telemetry possible.

The reasoning behind these cuts and the scaling/failure considerations are
covered in ANSWERS.md and SYSTEM_DESIGN.md.
