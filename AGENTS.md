# Suka

## Project Intent

`suka` is a native, always-on, Pi-powered personal assistant daemon for one operator.

Prefer simple, explicit architecture over generic platform machinery.

## Core decisions

- Runtime: Bun + TypeScript.
- Prefer Bun native/runtime APIs before adding third-party dependencies. Check Bun's agent-friendly docs/table of contents first (`https://bun.com/docs/llms.txt`).
- Useful Bun built-ins to remember: `Bun.file`, `Bun.write`, `Bun.serve`, `Bun.spawn`, `Bun.sleep`, `Bun.deepEquals`, `Bun.escapeHTML`, `Bun.gzipSync`/`Bun.gunzipSync`, `Bun.deflateSync`/`Bun.inflateSync`, `Bun.hash`, `Bun.password`, `Bun.randomUUIDv7`, `import.meta.dir`, `import.meta.file`, `import.meta.path`, `Bun.main`, `Bun.which`, `Bun.Cron`, `bun:sqlite` for unrelated projects (not this one), native test runner, bundler, and package manager utilities.
- New dependencies require justification: prefer copying a small helper or using a Bun/Node built-in over pulling another registry raccoon into the house.
- Database: PostgreSQL only. Do not add SQLite or generic multi-database abstractions.
- Query style: handwritten SQL and small typed stores. No ORM.
- Channels: Telegram and web are first-class. CLI/TUI/Unix socket can come later.
- Pi integration: reuse Pi provider/session/extension design where practical.
- Let Pi be Pi; `suka` should just give Pi a phone.
- The daemon process working directory is the agent workspace. Prefer systemd `WorkingDirectory=` over app-specific workspace config.
- Security: private VPN/systemd containment is assumed initially; do not overbuild product auth yet.
- Telegram must enforce an explicit sender allowlist before messages enter the durable bus. Use `SUKA_TELEGRAM_ALLOWED_SENDERS`.

## Validation

Use:

```bash
bun run typecheck
bun run lint
```

Add narrower commands as the repo grows.
