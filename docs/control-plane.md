# Control Plane

Porter exposes a REST API over a UNIX domain socket for runtime management:
scheduled task CRUD, daemon health, and worker pool observability. The socket
uses systemd socket activation in production and direct binding in development.

## Architecture

```
porter CLI ──fetch(unix)──> porter.sock ──> Bun.serve (ControlServer)
                                                │
                                    ┌───────────┼───────────┐
                                    │           │           │
                            SchedulerRegistry  TaskStore  WorkerPool
```

The control server runs inside the daemon process alongside channels, the
inbound/outbound workers, and the scheduler registry. No separate process, no
TCP port.

## Socket activation

In production (systemd template pair):

```ini
# porter@.socket
ListenStream=%t/porter/porter-%i.sock
SocketMode=0600
```

Systemd creates the socket before the service starts and passes it as fd 3.
The daemon detects `LISTEN_FDS=1` and calls `Bun.serve({ fd: 3 })`.
`RemoveOnStop=yes` handles cleanup.

In development (no socket unit, `bun run`):

```bash
# Daemon binds directly:
bun run runtime/src/index.ts --serve
# Socket created at $XDG_RUNTIME_DIR/porter/porter.sock (fallback: ~/.local/state/porter/porter.sock)
```

The CLI locates the socket via `PORTER_SOCKET` env var with a fallback to
`$XDG_RUNTIME_DIR/porter/porter.sock`.

## API Reference

All endpoints return JSON. Error responses include an `error` field.

### Health

```
GET /api/health
```

```json
{
  "status": "ok",
  "uptime": 12345.678,
  "pid": 12345,
  "workers": 2
}
```

### Scheduled Tasks

#### List all tasks

```
GET /api/scheduled-tasks
```

Returns an array of task objects including `paused` and `completed` tasks.

#### Get one task

```
GET /api/scheduled-tasks/:id
```

Returns a single task object, or `404`.

#### Create a task

```
POST /api/scheduled-tasks
Content-Type: application/json

{
  "id": "morning-brief",
  "name": "Morning Briefing",
  "prompt": "Summarize today's calendar and weather.",
  "agentSessionKey": "main:telegram:default:dm:123456",
  "scheduleType": "cron",
  "scheduleValue": "0 9 * * *",
  "reportSessionKey": "main:telegram:default:dm:123456",
  "workdir": null,
  "preHook": null,
  "postHook": null
}
```

| Field | Required | Notes |
|-------|----------|-------|
| `id` | yes | Unique task identifier (slug) |
| `prompt` | yes | Prompt sent to the agent |
| `agentSessionKey` | yes | Session key for the agent run |
| `scheduleType` | yes | `cron`, `interval`, or `once` |
| `scheduleValue` | yes | Cron expression, milliseconds, or `"0"` for once |
| `name` | no | Human-readable label |
| `reportSessionKey` | no | Where to deliver results (defaults to agent session) |
| `workdir` | no | Working directory for the agent |
| `preHook` | no | Shell command run before the agent |
| `postHook` | no | Shell command run after the agent |

Session keys for `agentSessionKey` and `reportSessionKey` are auto-created if
they don't already exist.

Returns `201` with the created task object. Returns `409` if the id already
exists.

#### Delete a task

```
DELETE /api/scheduled-tasks/:id
```

Pauses the task (disarms the timer) then removes it from the database.
Returns `204`.

#### Pause a task

```
POST /api/scheduled-tasks/:id/pause
```

Disarms the timer. The task stays in the database with `status: "paused"`.
Returns `409` if already paused or completed.

```json
{ "id": "morning-brief", "status": "paused" }
```

#### Resume a task

```
POST /api/scheduled-tasks/:id/resume
```

Re-arms the timer via the scheduler registry. Returns `409` if not paused.

```json
{ "id": "morning-brief", "status": "active" }
```

#### Fire a task immediately

```
POST /api/scheduled-tasks/:id/fire
```

Publishes an inbound event for the task without waiting for the schedule.
Does not affect the existing timer. Returns `409` if the task is not active.

```json
{ "id": "morning-brief", "fired": true }
```

#### Get run history

```
GET /api/scheduled-tasks/:id/runs?limit=50
```

Returns recent run records (newest first), up to `limit` (default 50).

### Workers

```
GET /api/workers
```

```json
{
  "count": 2,
  "snapshot": [
    { "sessionKey": "main:telegram:default:dm:123456", "state": "ready" },
    { "sessionKey": "main:telegram:default:dm:789012", "state": "busy" }
  ]
}
```

Worker states: `booting` (initializing Pi session), `ready` (idle), `busy`
(handling a prompt).

## CLI

```bash
# Set socket path for template instances:
export PORTER_SOCKET=$XDG_RUNTIME_DIR/porter/porter-projects-me-pi-porter.sock

porter task list
porter task get morning-brief
porter task create --id nightly-report --cron "0 2 * * *" \
  --prompt "Generate daily summary" \
  --session-key "main:telegram:default:dm:123456"
porter task delete morning-brief
porter task pause morning-brief
porter task resume morning-brief
porter task fire morning-brief
porter task runs morning-brief
porter status
porter help
```

### Create flags

| Flag | Notes |
|------|-------|
| `--id <slug>` | Required |
| `--prompt <text>` | Required |
| `--session-key <key>` | Required |
| `--cron <expr>` | e.g. `"0 9 * * *"` |
| `--interval <ms>` | Milliseconds |
| `--once` | One-shot, fires immediately on create |
| `--name <name>` | Optional label |
| `--report-key <key>` | Where to deliver results |
| `--workdir <path>` | Agent working directory |
| `--pre-hook <cmd>` | Shell command before agent |
| `--post-hook <cmd>` | Shell command after agent |

One of `--cron`, `--interval`, or `--once` is required.

## curl

```bash
curl --unix-socket "$PORTER_SOCKET" http://localhost/api/health
curl --unix-socket "$PORTER_SOCKET" http://localhost/api/scheduled-tasks

curl --unix-socket "$PORTER_SOCKET" \
  -X POST http://localhost/api/scheduled-tasks \
  -H 'Content-Type: application/json' \
  -d '{"id":"test","prompt":"hello","agentSessionKey":"main:telegram:default:dm:123456","scheduleType":"once","scheduleValue":"0"}'
```
