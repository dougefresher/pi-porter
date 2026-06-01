# Porter

## Project Intent

`porter` is a native, always-on, Pi-powered personal assistant daemon for one operator.

Prefer simple, explicit architecture over generic platform machinery.

## Goals

- Always-on personal assistant daemon, closer to `tmux`/`screen` than a SaaS app.
- Let Pi be Pi; `porter` should just give Pi a phone.
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

Pi owns provider/model/tool/settings resolution through normal global and project-local settings. `porter` does not set `PORTER_AGENT_MODEL` or maintain a parallel model config.

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

## Bun Utils

- Check Bun docs first (`https://bun.com/docs/llms.txt`), especially runtime file I/O guidance (`https://bun.com/docs/runtime/file-io.md`).
- Useful Bun built-ins to remember: `Bun.file`, `Bun.write`, `Bun.serve`, `Bun.spawn`, `Bun.sleep`, `Bun.deepEquals`, `Bun.escapeHTML`, `Bun.gzipSync`/`Bun.gunzipSync`, `Bun.deflateSync`/`Bun.inflateSync`, `Bun.hash`, `Bun.password`, `Bun.randomUUIDv7`, `import.meta.dir`, `import.meta.file`, `import.meta.path`, `Bun.main`, `Bun.which`, `Bun.Cron`, native test runner, bundler, and package manager utilities.
- Bun-first policy: prefer Bun runtime APIs over Node.js APIs whenever Bun provides a native equivalent.
- File I/O policy (critical): use Bun-native file APIs by default.
  - Read files with `Bun.file(path).text()/json()/bytes()`
  - Write files with `Bun.write(...)`
  - Delete files with `Bun.file(path).delete()`
  - Prefer `Bun.Glob` for file discovery patterns
  - Use Node `node:fs` only for gaps Bun does not cover well (mostly directory operations like `readdir`/`mkdir` when not practical via Bun helpers)
- Shell/process policy: for simple runtime filesystem shell ops in Bun daemons, prefer `Bun.$` over Node child_process wrappers.

### Bun SQL

  Always use Bun SQL api see https://bun.com/docs/runtime/sql.md for more details.

  Example code:

  ```
    import { sql } from "bun";
    // Uses PostgreSQL if DATABASE_URL is not set or is a PostgreSQL URL
    await sql`SELECT ...`;

    import { SQL } from "bun";
    const pg = new SQL("postgres://user:pass@localhost:5432/mydb");
    await pg`SELECT ...`;
  ```

### Bun Cron

See [./docs/bun-cron.md](./docs/bun-cron.md) for Bun's cron API

### Bun Markdown & HTML

For channel rich text (Matrix outbound HTML, inbound `formatted_body` → plaintext), prefer Bun built-ins over markdown-it or similar:

- [Bun Markdown](https://bun.com/docs/runtime/markdown.md) — `Bun.markdown.html()`, `Bun.markdown.render()`
- [Bun HTMLRewriter](https://bun.com/docs/runtime/html-rewriter.md) — sanitize HTML and strip to plaintext

Reference implementation: `runtime/src/channels/matrix/matrix-html.ts`. Bun marks the markdown API as unstable — keep calls behind that module.

## Core decisions

- Runtime: Bun + TypeScript.
- Error-handling policy (strict): never swallow mutating filesystem/database errors.
  - Forbidden pattern: `.catch(() => {})` on writes/deletes/moves/updates.
  - For destructive operations (delete/truncate/archive), always handle errors explicitly: log context + surface failure to caller/user flow.
  - If cleanup failure is non-fatal, log it with enough context to debug later; do not silently ignore it.
- New dependencies require justification: prefer copying a small helper or using a Bun/Node built-in over pulling another registry raccoon into the house.
- Database: PostgreSQL only. Do not add SQLite or generic multi-database abstractions.
- Query style: handwritten SQL and small typed stores. No ORM.
- Channels: Telegram and web are first-class. CLI/TUI/Unix socket can come later.
- Pi integration: reuse Pi provider/session/extension design where practical.
- The daemon process working directory is the agent workspace. Prefer systemd `WorkingDirectory=` over app-specific workspace config.
- Security: private VPN/systemd containment is assumed initially; do not overbuild product auth yet.
- Telegram must enforce an explicit sender allowlist before messages enter the durable bus. Use `PORTER_TELEGRAM_ALLOWED_SENDERS`.

## Performance & allocations

Porter is a long-running daemon. Optimize for steady-state cost, not startup.

**Hot paths** (treat allocations as expensive):

- Channel inbound handlers (Matrix/Telegram sync events)
- Bus publish/consume loops
- Outbound delivery and session-key routing on every message

**Cold paths** (clarity first):

- Config/env parsing at startup
- Migrations, doctor, one-off CLI

Guidelines:

- Early-return before normalizing strings (`trim`, `toLowerCase`, `split`, regex).
- Avoid intermediate strings/objects when the value is unused (e.g. don't build `chatId` before access checks fail).
- Prefer parsing once and passing through; don't re-encode/decode the same ID in the same request path.
- No extra copies: spread/rest, `[...arr]`, `.map` chains, template strings in tight loops — only when needed.
- Logging: avoid building large objects/strings unless the log level would emit them.

Do not micro-optimize tests, migrations, or one-shot setup for allocation savings alone.
When adding a hot-path helper, ask: "does this run per message/event?"

## Validation

Local gate:

```bash
bun run check
```

That runs `typecheck`, `lint`, `check:silent-swallows`, and `test`. Narrower commands:

```bash
bun run typecheck
bun run lint
bun run check:silent-swallows
bun run test
```

## CI (Buildkite)

CI is Buildkite not GitHub Actions.

- Pipeline slug: `pi-porter`
- Repo: `dougefresher/pi-porter`
- Default branch: `main`
- Triggers: branch pushes and pull requests (GitHub App provider)

The pipeline bootstrap step uploads a dynamic config from the centralized template repo:

```yaml
curl -sL --fail https://github.com/dougefresher/buildkite/raw/refs/heads/main/builds/bun/pipeline.yml | buildkite-agent pipeline upload
```

When changing validation scripts or `package.json` `check`, assume Buildkite will run the same `bun run check` gate.
