# Configuration

Work in progress. Porter reads **environment variables** only (no config file yet). Source of truth: `runtime/src/config.ts`.

Boolean env values: `1`, `true`, `yes`, or `on` (case-insensitive). CSV lists are comma-separated.

## Core

| Variable | Default | Notes |
| ---------- | --------- | ------- |
| `PORTER_STATE_DIR` | `~/.local/state/porter` | Runtime state, Pi sessions, cron logs |
| `PORTER_CONFIG_DIR` | `~/.config/porter` | Reserved for future config files |
| `PORTER_SOCKET` | `$XDG_RUNTIME_DIR/porter/porter.sock` | Control plane UNIX socket path (CLI only) |
| `DATABASE_URL` | — | PostgreSQL connection URL (required) |

## Agent

| Variable | Default | Notes |
| ---------- | --------- | ------- |
| `PORTER_AGENT_PROMPT_TIMEOUT_MS` | `900000` | Max time per agent prompt (ms) |

Model/provider/tool settings come from Pi global and project-local config — porter does not define a parallel model env layer.

## Telegram

| Variable | Default | Notes |
| ---------- | --------- | ------- |
| `PORTER_TELEGRAM_ENABLED` | `0` | Enable Telegram long polling |
| `PORTER_TELEGRAM_BOT_TOKEN` | — | Required when enabled. Fallback: `TELEGRAM_BOT_TOKEN` |
| `PORTER_TELEGRAM_ALLOWED_SENDERS` | — | Required when enabled. Numeric sender IDs; `*` allows all |
| `PORTER_TELEGRAM_POLL_TIMEOUT_SECONDS` | `30` | Long-poll timeout |

## Matrix

| Variable | Default | Notes |
| ---------- | --------- | ------- |
| `PORTER_MATRIX_ENABLED` | `0` | Enable Matrix sync. Fallback: `MATRIX_ENABLED` |
| `PORTER_MATRIX_HOMESERVER_URL` | — | Required when enabled. Fallback: `MATRIX_HOMESERVER_URL` |
| `PORTER_MATRIX_ACCESS_TOKEN` | — | Required when enabled. Fallback: `MATRIX_ACCESS_TOKEN` |
| `PORTER_MATRIX_USER_ID` | — | Bot MXID (optional if token resolves via whoami). Fallback: `MATRIX_USER_ID` |
| `PORTER_MATRIX_ALLOWED_SENDERS` | — | Required when enabled. MXIDs or `*`. Fallback: `MATRIX_ALLOWED_SENDERS` |
| `PORTER_MATRIX_ALLOWED_ROOMS` | — | Room IDs or `*`; empty = all rooms allowed. Fallback: `MATRIX_ALLOWED_ROOMS` |
| `PORTER_MATRIX_AUTO_JOIN_INVITES` | `1` | Auto-accept room invites. Fallback: `MATRIX_AUTO_JOIN_INVITES` |
| `PORTER_MATRIX_REQUIRE_MENTION` | `1` | Rooms require bot mention; DMs exempt |
| `PORTER_MATRIX_REPLY_PREFIX` | `porter` | Prefix on outbound room messages; skipped in DMs. Empty disables |
| `PORTER_MATRIX_FORMAT_HTML` | `1` | Send `formatted_body` HTML for agent replies |
| `PORTER_MATRIX_THREAD_REPLIES` | `always` | Thread session routing: `off`, `inbound`, or `always`. See `./docs/matrix.md` |
| `PORTER_MATRIX_ACK_REACTION` | `👀` | Emoji reaction on accepted inbound messages; set empty to disable |
| `PORTER_MATRIX_SYNC_TIMEOUT_MS` | `120000` | Startup sync deadline (read in matrix channel, not `config.ts`) |

## Legacy Aliases

Some Matrix/Telegram vars accept shorter names without the `PORTER_` prefix (see fallbacks above). Prefer `PORTER_*` for new setups.
