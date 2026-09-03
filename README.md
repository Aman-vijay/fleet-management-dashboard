# Fleet Management Dashboard — bootstrap skeleton

Minimal dev skeleton for Assignment 2 (Backend). No business logic yet.

## Layout

- `backend/` — Fastify + MQTT + WebSocket service (placeholder `src/server.ts`)
- `robot-simulator/` — telemetry publisher (placeholder `src/index.ts`)
- `data/` — `robots.json`, `events.jsonl` (consumed later)

## Scripts

Root: `npm run build`, `npm run test`.
Backend: `npm run dev|build|start|test`.
Simulator: `npm run dev|build|start`.

## Docker

`docker compose config` validates; `docker compose up` starts broker, backend, simulator.
