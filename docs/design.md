# suka design sketch

## Goals

- Always-on personal assistant daemon, closer to `tmux`/`screen` than a SaaS app.
- Let Pi be Pi; `suka` should just give Pi a phone.
- Mobile-first interaction through Telegram.
- Web UI/control panel where richer surfaces help.
- Scheduler and Dream-style memory maintenance as first-class runtime features.
- PostgreSQL + pgvector as the durable state and retrieval substrate.
- Reuse Pi provider/session/extension concepts instead of inventing a new agent framework.

## Non-goals

- Multi-user product auth.
- Add-on marketplace/catalog machinery.
- Multi-database portability.
- Dockerizing the app runtime.
- Persistent terminal sessions or surviving in-flight agent runs across daemon restart.

## Runtime shape

```text
Telegram/Web/Scheduler -> inbound_events -> InboundWorker -> Pi AgentSession -> outbound_deliveries -> OutboundWorker -> ChannelAdapter
```

The daemon process working directory is the agent workspace. Under systemd, use `WorkingDirectory=`. Do not invent a second workspace layer on top of pi-coding-agent.

Pi owns provider/model/tool/settings resolution through normal global and project-local settings. `suka` does not set `SUKA_AGENT_MODEL` or maintain a parallel model config.

Replies route deterministically back to the channel/conversation that caused the run unless a scheduled job explicitly configures a different reporting channel.

Transport tables are a durable Postgres message bus, not the transcript store. This keeps crash recovery and replay separate from context shaping and long-term memory.

## PostgreSQL stance

Postgres is part of the platform. The app should use Postgres features directly:

- `jsonb`
- enums/domains where useful
- full-text search
- `pg_trgm`
- `pgvector`
- advisory locks / `listen notify` later if useful

Avoid lowest-common-denominator schemas. Avoid ORMs.

## Session keys

Durable routing identity uses:

```text
{agentId}:{source}:{accountId}:{peerKind}:{peerId}[:thread:{threadId}]
```

Examples:

```text
main:telegram:default:dm:123456
main:telegram:default:group:-1001234567890:thread:42
main:webchat:default:direct:default
```

Channel-local target addresses, such as `telegram:-100123:topic:42`, stay in delivery metadata/chat IDs. The app-level session identity is always `session_key`.

## Initial milestones

1. Repo skeleton and daemon lifecycle.
2. Postgres connection and migrations.
3. Postgres-backed inbound/outbound bus.
4. Telegram channel can receive and send messages through the bus.
5. Minimal Pi agent turn from Telegram.
6. Persist transcript rows and run audit data.
7. Minimal web view/control surface.
8. Scheduler.
9. Dream memory maintenance.
10. Ghostty terminal integration from Piclaw.
