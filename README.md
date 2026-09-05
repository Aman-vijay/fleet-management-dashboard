# Fleet Management Dashboard — Assignment 2 (Backend)

Backend for a fleet of 8 simulated robots: MQTT ingestion, in-memory fleet
state, REST polling + WebSocket push over the same state, all on Docker Compose.

## Run it

Prerequisites: Docker (recent) and Node.js 22+ for local scripts.

```powershell
npm install
docker compose up --build        # broker + backend + 8 robot publishers
```

`docker compose up` is the whole submission: Mosquitto (with healthcheck),
backend on `:3000`, and `robot-r1`…`robot-r8`, each replaying its recorded
events from `data/events.jsonl` in order. Robots start only after the broker
is healthy and the backend is up, so the backend's subscription exists before
the first publish. `REPLAY_SPEED` scales the recorded 5s cadence
(`$env:REPLAY_SPEED="60"; docker compose up --build` for a ~15s full run).

Local dev: `npm run dev --workspace backend` (needs a broker on
`localhost:1883`; `docker compose up mosquitto` suffices),
`ROBOT_ID=r3 npm run dev --workspace robot-simulator` for one robot.
`npm run build --workspaces`, `npm run test --workspaces`.

## Try it

```powershell
curl http://localhost:3000/robots        # [] until robots publish, then 8 states
curl http://localhost:3000/robots/r3     # one robot
curl http://localhost:3000/robots/r9     # 404 + error JSON
# WebSocket: snapshot on connect, then live updates —
node -e "const w=new WebSocket('ws://localhost:3000/ws');w.onmessage=e=>console.log(e.data.slice(0,160))"
```

## Layout

- `backend/src/mqtt/consumer.ts` — subscribes `fleet/+/telemetry` (QoS 1),
  JSON-parse → Zod validate → topic/payload id match → type lookup → `FleetState`
- `backend/src/state/fleet-state.ts` — the single source of truth:
  `Map<robot_id, RobotState>`, newest-`t`-wins, `onUpdate` hook for push consumers
- `backend/src/http/robots.ts` — `GET /robots`, `GET /robots/:robotId` via the
  `toPublic()` whitelist mapper (`lastSeenAt` never leaves the process)
- `backend/src/websocket/stream.ts` — `GET /ws`: snapshot on connect, per-update
  fanout, lagging sockets terminated past 256 KB unsent
- `robot-simulator/src/` — one publisher per robot (`ROBOT_ID`), replays its
  `events.jsonl` lines in order at QoS 1
- `data/` — `robots.json` (roster + robot types), `events.jsonl` (1,448 events, t=0→900)

## Design decisions (short)

See `ANSWERS.md` for the argued versions. In brief: MQTT because the brief
wants a producer/consumer split and it models robot telemetry well; QoS 1 +
newest-`t`-wins dedupe for at-least-once ingest; one in-memory `FleetState`
(rather than a store) because only *current* state is served and both
consumers must read the same object; WS fanout is best-effort with snapshot
resync rather than guaranteed delivery, so a lagging client can never
back-pressure the server.

## AI delegation notes

Built with AI assistance (OpenCode, Muse Spark model): project bootstrap and
npm/Docker scaffolding, the simulator publisher, the backend ingestion/REST/WS
layers, the test suites, and drafts of `ANSWERS.md`/`SYSTEM_DESIGN.md`/this
README. Architecture and scope decisions were the author's: MQTT over
alternatives, 8 compose services for the fleet, in-memory state with no store,
QoS 1 + `t`-ordering, snapshot-plus-fanout WS protocol, and every documented
cut (history endpoint, stale-marking, auth). Every AI-generated part was
verified by execution (strict `tsc`, Vitest, live `docker compose` runs with
payload cross-checked against source data) and is explainable file by file —
see the walkthrough notes below.

## What I cut, and what's next

Cut: history endpoint, stale/offline marking for silent robots, auth, ARM
platform pinning (built/tested on x86_64). Next, in order: a staleness sweep
over `lastSeenAt` surfaced through `toPublic` + `onUpdate` (silent robots are
the least-visible failure today), then a SQLite history store appended at the
single `FleetState.update()` choke point. Full reasoning in `ANSWERS.md` Q3
and `SYSTEM_DESIGN.md` Q4–Q5.
