# porter

`porter` is a native, always-on, Pi-powered personal assistant daemon.

Let Pi be Pi; `porter` should just give Pi a phone.

Initial direction:

- native Bun/TypeScript runtime, no app container requirement
- PostgreSQL as the only application database
- Telegram-first mobile channel
- web channel/control panel later, borrowing Piclaw UI pieces where practical
- Telegram sender allowlist before durable bus ingress
- Pi provider/session/extension model reused as much as possible
- process working directory is the agent workspace; use systemd `WorkingDirectory=` for daemon deployment
- scheduler and Dream-style memory maintenance as first-class background features

This repo is intentionally personal infrastructure, not a multi-user product.
