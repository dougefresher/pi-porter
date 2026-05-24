# Suka

## Project Intent

`suka` is a native, always-on, Pi-powered personal assistant daemon for one operator.

Prefer simple, explicit architecture over generic platform machinery.

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
- Telegram must enforce an explicit sender allowlist before messages enter the durable bus. Use `SUKA_TELEGRAM_ALLOWED_SENDERS`.

## Validation

Local gate:

```bash
bun run check
```

That runs `typecheck`, `lint`, and `check:silent-swallows`. Narrower commands:

```bash
bun run typecheck
bun run lint
bun run check:silent-swallows
```

## CI (Buildkite)

CI is Buildkite not GitHub Actions.

- Pipeline slug: `pi-suka`
- Repo: `dougefresher/pi-suka`
- Default branch: `main`
- Triggers: branch pushes and pull requests (GitHub App provider)

The pipeline bootstrap step uploads a dynamic config from the centralized template repo:

```yaml
curl -sL --fail https://github.com/dougefresher/buildkite/raw/refs/heads/main/builds/bun/pipeline.yml | buildkite-agent pipeline upload
```

When changing validation scripts or `package.json` `check`, assume Buildkite will run the same `bun run check` gate.
