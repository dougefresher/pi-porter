# Matrix Channel

Porter connects to a Matrix homeserver as a **user bot** -- a regular non-admin
user account that listens for messages and replies. It does not require a bot
SDK, an appservice registration, or homeserver admin privileges once the
account exists and is logged in.

The implementation lives in `runtime/src/channels/matrix/`. It uses
[matrix-js-sdk][matrix-js-sdk] (v41.6.0) and syncs via the normal client-server
API.

[matrix-js-sdk]: https://github.com/matrix-org/matrix-js-sdk

## Quick start

At minimum:

```bash
export PORTER_MATRIX_ENABLED=1
export PORTER_MATRIX_HOMESERVER_URL="https://matrix.example.com"
export PORTER_MATRIX_ACCESS_TOKEN="syt_cG9ydGVy..."   # from login step below
export PORTER_MATRIX_ALLOWED_SENDERS="@you:example.com"
```

Start porter. The channel auto-syncs, auto-joins invited rooms (by default),
and replies to DMs and @-mentions.

## Creating a bot user

Porter talks Matrix as a normal user. You need:

1. A user account on the homeserver (username + password).
2. An **access token** scoped to that user -- obtained by logging in once.

The exact steps depend on your homeserver.

### On Tuwunel

Tuwunel's authentication docs live at
[docs/authentication/legacy.md](https://github.com/matrix-construct/tuwunel/blob/101a45e2a880303e2a580e82e6f1340e3a61066d/docs/authentication/legacy.md)
in the repo. The homeserver uses a **registration token** system to gate
account creation.

#### Step 1: Enable registration with a token

In `/etc/tuwunel/tuwunel.toml`:

```toml
allow_registration = true
registration_token = "o&^uCtes4HPf0Vu@F20jQeeWE7"
```

Or load tokens from a file to rotate without restarting:

```toml
allow_registration = true
registration_token_file = "/etc/tuwunel/.reg_tokens"
```

Restart tuwunel after changing the config.

#### Step 2: Register the bot account

Use any Matrix client (Element, SchildeChat, `matrix-commander`, or a raw
`curl` against `/_matrix/client/v3/register`). During registration, supply the
token as the `auth` payload:

**With curl:**

```bash
# 1. Get the registration flows to confirm token-based registration is enabled
curl -s "https://matrix.example.com/_matrix/client/v3/register" | jq '.'

# 2. Register with the token
curl -s -X POST "https://matrix.example.com/_matrix/client/v3/register" \
  -H "Content-Type: application/json" \
  -d '{
    "auth": {
      "type": "m.login.registration_token",
      "token": "o&^uCtes4HPf0Vu@F20jQeeWE7"
    },
    "username": "porter",
    "password": "a-strong-generated-password-here",
    "inhibit_login": false
  }'
```

The response includes `access_token` and `device_id`. Save the access token --
that is `PORTER_MATRIX_ACCESS_TOKEN`.

**With Element/SchildeChat:**

1. Open the client, enter your homeserver URL.
2. On the registration form, enter the token when prompted.
3. Pick username `porter` and a strong password.
4. After registration, go to Settings -> Help & About -> Access Token to copy
   the token. (Alternatively, log out and use the curl login method below --
   some clients don't expose the raw token.)

**Alternative: Admin-room user creation (Tuwunel)**

If you already have an admin account on the server, join the admin room
(`#admins:<server_name>`) and issue:

```
!admin users create porter
```

Tuwunel generates a random password and prints it. Log in once with that
password to get a token (see [Getting an access token](#getting-an-access-token)).

#### Step 3: Getting an access token

If registration didn't return a token, or you need a fresh one, log in:

```bash
curl -s -X POST "https://matrix.example.com/_matrix/client/v3/login" \
  -H "Content-Type: application/json" \
  -d '{
    "type": "m.login.password",
    "identifier": {
      "type": "m.id.user",
      "user": "porter"
    },
    "password": "a-strong-generated-password-here",
    "initial_device_display_name": "porter-daemon"
  }'
```

The response:

```json
{
  "user_id": "@porter:example.com",
  "access_token": "syt_cG9ydGVy...",
  "device_id": "ABCDEFGHIJ",
  "home_server": "example.com"
}
```

Use the `access_token` value as `PORTER_MATRIX_ACCESS_TOKEN`.

**Token expiry note:** Tuwunel defaults to 7-day access token expiry
([`access_token_ttl = 604800`](https://github.com/matrix-construct/tuwunel/blob/101a45e2a880303e2a580e82e6f1340e3a61066d/docs/authentication/legacy.md#token-and-session-lifetimes)).
Porter does **not** implement token refresh yet, so for long-running daemons,
either:

- Set `access_token_ttl` high (e.g. `31536000` for 1 year) in tuwunel config.
- Or use a homeserver that issues non-expiring tokens (Synapse with
  `refreshable_access_token_lifetime: 0` -- disabled).

Porter will fail to sync when the token expires. A restart with a fresh token
fixes it.

### On Synapse

Synapse supports a shared-secret registration API that bypasses the normal
registration flow:

```bash
# Synapse homeserver.yaml needs:
#   registration_shared_secret: "your-secret-here"

curl -s -X POST "https://matrix.example.com/_synapse/admin/v1/register" \
  -H "Content-Type: application/json" \
  -d '{
    "nonce": "'$(head -c 16 /dev/urandom | base64 | tr -d '=' | tr '+/' '_-')'",
    "username": "porter",
    "password": "a-strong-generated-password",
    "admin": false,
    "mac": "'$(echo -n "${NONCE}\0porter\0password\0notadmin" | openssl dgst -sha1 -hmac "your-secret-here" | awk '{print $NF}')'"
  }'
```

Then log in as above for an access token.

### On Dendrite / Conduit / other homeservers

Create a normal user account through the client registration flow. If the
homeserver requires a registration token or invitation, create one through the
admin API or admin room. Then log in once to get an access token.

The only requirement is that porter receives a valid access token for a user
account on the server.

## Configuration reference

All Matrix env vars and their defaults are in `./docs/config.md`. The ones you
will touch most often:

| Variable | Required | Purpose |
| ---------- | ---------- | --------- |
| `PORTER_MATRIX_ENABLED` | yes | Set to `1` |
| `PORTER_MATRIX_HOMESERVER_URL` | yes | e.g. `https://matrix.example.com` |
| `PORTER_MATRIX_ACCESS_TOKEN` | yes | From the login step |
| `PORTER_MATRIX_USER_ID` | no | Auto-resolved from whoami if omitted |
| `PORTER_MATRIX_ALLOWED_SENDERS` | yes | MXIDs that can trigger porter; `*` for anyone |
| `PORTER_MATRIX_ALLOWED_ROOMS` | no | Room IDs porter responds in (empty = all rooms) |
| `PORTER_MATRIX_REQUIRE_MENTION` | no | Default `1`; DMs always bypass this |
| `PORTER_MATRIX_AUTO_JOIN_INVITES` | no | Default `1`; auto-accept room invites |
| `PORTER_MATRIX_SYNC_TIMEOUT_MS` | no | Default `120000`; startup sync deadline in ms |

## Access control

Porter has two layers of access control before a message enters the agent
queue.

### Sender allowlist

`PORTER_MATRIX_ALLOWED_SENDERS` is a comma-separated list of full Matrix user
IDs:

```bash
export PORTER_MATRIX_ALLOWED_SENDERS="@you:example.com,@friend:matrix.org"
```

Or allow everyone (not recommended on federated servers):

```bash
export PORTER_MATRIX_ALLOWED_SENDERS=*
```

Messages from non-allowlisted senders are dropped with a log warning. The
sender is never notified.

### Room allowlist

`PORTER_MATRIX_ALLOWED_ROOMS` restricts which group rooms porter responds in.
DMs are always allowed regardless of this setting.

```bash
export PORTER_MATRIX_ALLOWED_ROOMS="!abc123:example.com,!def456:matrix.org"
```

An empty list (or `*`) means all rooms are allowed. This is the default.

### Room mentions

When `PORTER_MATRIX_REQUIRE_MENTION` is set (the default), porter only responds
to group-room messages that mention the bot. Mentions are detected via:

- Matrix `m.mentions` (the `user_ids` and `room` fields).
- `@room` in the message body (Element-style room-wide mention).
- `@porter:example.com` or `@porter` in the message body or formatted body.

**DMs always bypass the mention check.** If someone DMs the bot directly,
porter responds regardless of `requireMention`.

Slash commands (messages starting with `/`) also bypass the mention check --
they are handled as [admin commands](#commands) before the mention filter runs.

## Room setup

### Inviting the bot

With `PORTER_MATRIX_AUTO_JOIN_INVITES=1` (default):

1. From your client, create a room or open an existing one.
2. Invite `@porter:example.com`.
3. Porter auto-joins within seconds.

With `autoJoinInvites` disabled, you need to manually join the bot with
`!admin users force-join-room` (Tuwunel) or `/_synapse/admin` (Synapse).

### Starting a DM

Start a direct chat with the bot from your client. Porter detects DMs via
`m.direct` account data and responds immediately without requiring a mention.

### Threads

Porter detects thread replies (`m.thread` relation) and routes them to the
correct session key. The `chatId` includes the thread root event ID:

```
matrix:room:!room123:example.com:thread:$threadRootEventId
```

This means thread replies are handled as a separate conversation from the
main room timeline. Porter's reply will also be threaded under the same root.

### Replies and reply context

When someone replies to a previous message, porter fetches the replied-to event
and prepends context to the agent input:

```
[Replying to @alice:example.com: "the original message text..."]
new message here
```

The replied-to event ID is also passed through delivery metadata, so porter's
response can be sent as a Matrix reply (via `m.in_reply_to`).

## How session keys work

Porter maps Matrix conversations to stable session keys:

```
main:matrix:default:dm:<hex-encoded-room-id>
main:matrix:default:room:<hex-encoded-room-id>
main:matrix:default:room:<hex-encoded-room-id>:thread:<thread-root-event-id>
```

- **DMs** get `peerKind: dm`, which means they bypass the mention requirement.
- **Group rooms** get `peerKind: room` and require mentions.
- **Threads** append `:thread:<eventId>` for isolated sub-conversations.

The room ID is hex-encoded (not base64) to safely include `!` and `:` characters
in the session key. See `runtime/src/channels/matrix/matrix-targets.ts` and
`runtime/src/channels/matrix/session.ts` for the implementation.

Room chat IDs use the format:

```
matrix:room:!room123:example.com
matrix:room:!room123:example.com:thread:$eventId
```

## Commands

Messages that start with a `/` are checked against built-in slash commands
before entering the agent queue. Currently supported:

- `/help` -- show available commands.
- `/archive` -- archive the current session (stops agent, saves transcript,
  starts fresh).
- `/status` -- show current session status.

Commands are handled in `runtime/src/channels/matrix/commands.ts`. They bypass
the mention-required filter, so a room member can invoke them without @-mentioning
the bot.

## Limitations

### No end-to-end encryption

Porter does **not** implement Matrix E2EE (olm/megolm). The matrix-js-sdk
crypto stack (Rust WASM) is not initialised, and porter does not ship a crypto
store. Encrypted rooms will not work -- messages arrive as `m.room.encrypted`
events that porter cannot decrypt, and the bot will not respond.

**Workarounds:**

- **Unencrypted rooms.** Create a dedicated bot room without encryption.
  This is the simplest path and what most Matrix bots do.

- **Appservice.** Register porter as a Matrix Application Service. Appservices
  receive plaintext events from all rooms regardless of encryption state.
  This requires homeserver admin access and an appservice registration YAML.

- **Future E2EE support.** If porter ever ships E2EE, it would need a
  persistent crypto store (likely Postgres-backed), WASM crypto bindings,
  device verification UX, and key backup. This is tracked as a deferred
  enhancement.

### No token refresh

Porter does not refresh expiring access tokens. If your homeserver enforces
token expiry (Tuwunel defaults to 7 days), you need to either extend the TTL or
restart porter with a fresh token periodically.

### No read receipts / typing indicators for inbound

Porter sends typing indicators while the agent is processing (via
`/typing`), but does not send read receipts or track unread counts.

### Homeserver must be reachable

Porter uses the normal client-server sync API with long-polling. The homeserver
must be reachable on port 443 (or the configured port). If using delegation,
ensure your `.well-known` files are correctly set up.

## Troubleshooting

### Porter starts but doesn't respond to messages

**Check the access token.** Log in manually with curl and verify the token
still works:

```bash
curl -s -H "Authorization: Bearer $PORTER_MATRIX_ACCESS_TOKEN" \
  "https://matrix.example.com/_matrix/client/v3/account/whoami"
```

If this returns 401, the token is expired or invalid. Generate a new one.

**Check the sender allowlist.** Messages from senders not in
`PORTER_MATRIX_ALLOWED_SENDERS` are silently dropped. Check porter's logs for
`[matrix] rejected inbound message` entries.

**Check the room is unencrypted.** Encrypted messages are silently ignored.
Create an unencrypted room for the bot.

### Sync timeout on startup

Porter waits up to `PORTER_MATRIX_SYNC_TIMEOUT_MS` (default 120s) for the
initial sync to complete. If your homeserver is slow or has a large account
state, increase this:

```bash
export PORTER_MATRIX_SYNC_TIMEOUT_MS=300000  # 5 minutes
```

### "Matrix sync failed during startup" in logs

This typically means the homeserver is unreachable, the token is invalid, or
the server returned an error during sync. Check:

1. `PORTER_MATRIX_HOMESERVER_URL` is correct and reachable from the porter
   host.
2. The access token is valid (see whoami check above).
3. The homeserver isn't rate-limiting the initial sync (rare, but possible
   with restrictive reverse-proxy configs).

### Porter joins rooms but doesn't respond in them

The `requireMention` setting is likely active. Porter only responds to messages
that @-mention the bot in group rooms. Either:

- @-mention the bot in your message.
- Send a DM instead (DMs bypass the mention check).
- Set `PORTER_MATRIX_REQUIRE_MENTION=0` if you want porter to read all room
  messages.
