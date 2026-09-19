# OTLP server for claude-otlp-dashboard

This is the single OTLP server used by the existing backend and frontend.

```text
claude-otlp-dashboard/
├── otlp-server/        <- this folder
│   └── data/
│       ├── all-events.jsonl
│       ├── all-metrics.jsonl
│       ├── all-traces.jsonl
│       ├── logs.jsonl
│       └── metrics.json
├── backend/
└── frontend/
```

## Data flow

```text
Claude Code / Cowork
  -> POST /v1/logs
  -> Collector on port 4318
  -> data/logs.jsonl (backend feed)
  -> ../backend
  -> GET /api/v1/events and WS /ws/usage
  -> ../frontend
```

## First start

Keep the existing `.env` if it contains the bearer token already configured in
Claude/Cowork. Otherwise:

```powershell
Copy-Item .env.example .env
```

Replace the placeholder with a random token of at least 32 characters, then:

```powershell
.\scripts\start.ps1
.\scripts\test-endpoint.ps1
```

## Existing data layout

The Collector preserves all of your existing filenames:

```text
data/logs.jsonl          backend live-event feed
data/metrics.json        current metrics-compatible feed
data/all-events.jsonl    raw log archive copy
data/all-metrics.jsonl   raw metrics archive copy
data/all-traces.jsonl    raw traces archive
```

New log exports append to both `logs.jsonl` and `all-events.jsonl`. The backend
reads only `logs.jsonl`, so dashboard events are not duplicated.

## Backend contract

The existing `backend/.env` must contain:

```env
OTLP_RAW_DIR=../otlp-server/data
CORS_ORIGINS=http://localhost:5173,http://127.0.0.1:5173
```

The existing backend already accepts `logs.jsonl`, so no backend source-code
change is required. The Collector does not call the backend API.

## Frontend contract

The existing `frontend/.env` must contain:

```env
VITE_API_URL=http://127.0.0.1:8000
VITE_WS_URL=ws://127.0.0.1:8000/ws/usage
```

## Claude Code

Dot-source the configuration and run Claude from the same terminal:

```powershell
. .\scripts\configure-claude-code.ps1 `
  -EmployeeId "EMP-001" `
  -EmployeeEmail "user@company.com" `
  -EmployeeName "Employee Name"

claude --debug
```

## Cowork

Configure the public base endpoint, protocol `http/protobuf`, and header:

```text
Authorization=Bearer <same OTLP_TOKEN>
```

Cowork appends `/v1/logs` automatically. Start a new Cowork session after
saving monitoring settings.
