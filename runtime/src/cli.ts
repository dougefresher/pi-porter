/**
 * Porter client CLI. Talks to the daemon over a UNIX socket.
 *
 * Socket location (first found wins):
 *   1. PORTER_SOCKET env var
 *   2. $XDG_RUNTIME_DIR/porter/porter.sock
 *   3. $PORTER_STATE_DIR/porter.sock
 *   4. ~/.local/state/porter/porter.sock
 */

function socketPath(): string {
  if (process.env.PORTER_SOCKET) return process.env.PORTER_SOCKET;
  const runtimeDir = process.env.XDG_RUNTIME_DIR;
  if (runtimeDir) return `${runtimeDir}/porter/porter.sock`;
  const stateDir = process.env.PORTER_STATE_DIR || `${process.env.HOME}/.local/state/porter`;
  return `${stateDir}/porter.sock`;
}

async function apiFetch(path: string, init?: RequestInit): Promise<unknown> {
  const url = `http://localhost${path}`;
  const res = await fetch(url, { ...init, unix: socketPath() });
  const body = await res.text();
  if (!res.ok) {
    let message = `${res.status} ${res.statusText}`;
    try {
      const parsed = JSON.parse(body);
      if (parsed.error) message = parsed.error;
    } catch (err) {
      // Response body is not JSON; use raw status text.
      console.warn('[cli] failed to parse error response body', { status: res.status, err });
    }
    throw new Error(message);
  }
  if (res.status === 204) return null;
  return body ? JSON.parse(body) : null;
}

function printJson(data: unknown): void {
  console.log(JSON.stringify(data, null, 2));
}

// ---- Commands ----

async function cmdList(): Promise<void> {
  const tasks = await apiFetch('/api/scheduled-tasks');
  printJson(tasks);
}

async function cmdGet(id: string): Promise<void> {
  const task = await apiFetch(`/api/scheduled-tasks/${encodeURIComponent(id)}`);
  printJson(task);
}

async function cmdCreate(opts: Record<string, string | undefined>): Promise<void> {
  const id = opts.id;
  if (!id) throw new Error('--id is required');

  let scheduleType: string;
  let scheduleValue: string;
  if (opts.cron) {
    scheduleType = 'cron';
    scheduleValue = opts.cron;
  } else if (opts.interval) {
    scheduleType = 'interval';
    scheduleValue = opts.interval;
  } else if (opts.once !== undefined) {
    scheduleType = 'once';
    scheduleValue = opts.once || '0';
  } else {
    throw new Error('one of --cron, --interval, or --once is required');
  }

  const body: Record<string, unknown> = {
    id,
    scheduleType,
    scheduleValue,
    prompt: opts.prompt ?? '',
    agentSessionKey: opts['session-key'] ?? '',
  };
  if (opts.name !== undefined) body.name = opts.name || null;
  if (opts['report-key'] !== undefined) body.reportSessionKey = opts['report-key'] || null;
  if (opts.workdir !== undefined) body.workdir = opts.workdir || null;
  if (opts['pre-hook'] !== undefined) body.preHook = opts['pre-hook'] || null;
  if (opts['post-hook'] !== undefined) body.postHook = opts['post-hook'] || null;

  const task = await apiFetch('/api/scheduled-tasks', {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify(body),
  });
  printJson(task);
}

async function cmdDelete(id: string): Promise<void> {
  await apiFetch(`/api/scheduled-tasks/${encodeURIComponent(id)}`, { method: 'DELETE' });
  console.log(`deleted task ${id}`);
}

async function cmdPause(id: string): Promise<void> {
  const result = await apiFetch(`/api/scheduled-tasks/${encodeURIComponent(id)}/pause`, { method: 'POST' });
  printJson(result);
}

async function cmdResume(id: string): Promise<void> {
  const result = await apiFetch(`/api/scheduled-tasks/${encodeURIComponent(id)}/resume`, { method: 'POST' });
  printJson(result);
}

async function cmdFire(id: string): Promise<void> {
  const result = await apiFetch(`/api/scheduled-tasks/${encodeURIComponent(id)}/fire`, { method: 'POST' });
  printJson(result);
}

async function cmdRuns(id: string): Promise<void> {
  const runs = await apiFetch(`/api/scheduled-tasks/${encodeURIComponent(id)}/runs`);
  printJson(runs);
}

async function cmdStatus(): Promise<void> {
  const health = await apiFetch('/api/health');
  printJson(health);
}

// ---- Entry ----

export async function runCli(argv: string[]): Promise<void> {
  // argv = ['bun', 'index.ts', 'task', 'list', ...]  — strip runtime prefix
  const args = argv.slice(2);

  if (args.length === 0 || args[0] === 'help' || args[0] === '--help' || args[0] === '-h') {
    printHelp();
    return;
  }

  const subcommand = args[0];
  const rest = args.slice(1);

  try {
    switch (subcommand) {
      case 'task':
        await handleTask(rest);
        break;
      case 'status':
        await cmdStatus();
        break;
      default:
        console.error(`unknown command: ${subcommand}`);
        console.error('run `porter help` for usage');
        process.exit(1);
    }
  } catch (error) {
    if (error instanceof Error && error.message.includes('ConnectionRefused')) {
      console.error('daemon not running or socket not found');
      console.error(`  socket: ${socketPath()}`);
    } else {
      console.error(error instanceof Error ? error.message : String(error));
    }
    process.exit(1);
  }
}

function handleTask(args: string[]): Promise<void> {
  if (args.length === 0) {
    console.error('porter task: missing subcommand (list, get, create, delete, pause, resume, fire, runs)');
    process.exit(1);
  }

  const sub = args[0];
  const subArgs = args.slice(1);

  switch (sub) {
    case 'list':
      return cmdList();
    case 'get':
      return requireArg(subArgs, 'id').then((id) => cmdGet(id));
    case 'create':
      return cmdCreate(parseCreateArgs(subArgs));
    case 'delete':
      return requireArg(subArgs, 'id').then((id) => cmdDelete(id));
    case 'pause':
      return requireArg(subArgs, 'id').then((id) => cmdPause(id));
    case 'resume':
      return requireArg(subArgs, 'id').then((id) => cmdResume(id));
    case 'fire':
      return requireArg(subArgs, 'id').then((id) => cmdFire(id));
    case 'runs':
      return requireArg(subArgs, 'id').then((id) => cmdRuns(id));
    default:
      console.error(`porter task: unknown subcommand: ${sub}`);
      process.exit(1);
  }
}

function requireArg(args: string[], name: string): Promise<string> {
  if (args.length === 0) {
    console.error(`missing required argument: ${name}`);
    process.exit(1);
  }
  return Promise.resolve(args[0]!);
}

const VALUE_FLAGS = new Set([
  '--id',
  '--name',
  '--cron',
  '--interval',
  '--prompt',
  '--session-key',
  '--report-key',
  '--workdir',
  '--pre-hook',
  '--post-hook',
]);
const BOOL_FLAGS = new Set(['--once']);

function parseCreateArgs(args: string[]): Record<string, string | undefined> {
  const opts: Record<string, string | undefined> = {};
  let i = 0;
  while (i < args.length) {
    const arg = args[i]!;
    if (VALUE_FLAGS.has(arg)) {
      opts[arg.slice(2)] = args[++i] ?? '';
    } else if (BOOL_FLAGS.has(arg)) {
      opts[arg.slice(2)] = '';
      i++;
    } else {
      i++;
    }
  }
  return opts;
}

function printHelp(): void {
  console.log(
    'porter - Personal assistant daemon\n\n' +
      'Usage:\n' +
      '  porter                Client CLI (default)\n' +
      '  porter --serve        Start the daemon\n' +
      '  porter --help         Show help\n\n' +
      'Client commands:\n' +
      '  porter task list                  List all scheduled tasks\n' +
      '  porter task get <id>              Get task details\n' +
      '  porter task create ...            Create a new task\n' +
      '  porter task delete <id>           Delete a task\n' +
      '  porter task pause <id>            Pause a task\n' +
      '  porter task resume <id>           Resume a paused task\n' +
      '  porter task fire <id>             Trigger a task immediately\n' +
      '  porter task runs <id>             Show recent run history\n' +
      '  porter status                     Daemon health and stats\n\n' +
      'Task create options:\n' +
      '  --id <slug>           Required: unique task identifier\n' +
      '  --prompt <text>       Required: prompt to send to the agent\n' +
      '  --session-key <key>   Required: agent session key (e.g. main:telegram:default:dm:123456)\n' +
      '  --cron <expr>         Cron expression (e.g. "0 9 * * *")\n' +
      '  --interval <ms>       Interval in milliseconds\n' +
      '  --once                One-shot task (fires immediately on create)\n' +
      '  --name <name>         Human-readable name\n' +
      '  --report-key <key>    Session key for reporting results\n' +
      '  --workdir <path>      Working directory for the agent\n' +
      '  --pre-hook <cmd>      Shell command to run before the agent\n' +
      '  --post-hook <cmd>     Shell command to run after the agent\n\n' +
      'Internal (spawned by daemon):\n' +
      '  porter --agent-worker  Run as a long-lived agent worker process\n\n' +
      'Environment:\n' +
      '  DATABASE_URL                           PostgreSQL connection URL\n' +
      '  PORTER_TELEGRAM_ENABLED=1              Enable Telegram long polling\n' +
      '  PORTER_TELEGRAM_BOT_TOKEN=<token>      Telegram bot token\n' +
      '  PORTER_TELEGRAM_ALLOWED_SENDERS=<ids>  Comma-separated numeric sender IDs; * allows all\n' +
      '  PORTER_AGENT_PROMPT_TIMEOUT_MS=<ms>    Agent prompt timeout; default 900000\n' +
      '  PORTER_AGENT_WORKER_MAX_COUNT=<n>      Max agent worker processes; default 10\n' +
      '  PORTER_AGENT_WORKER_IDLE_TIMEOUT_MS=<ms>  Idle worker eviction; default 600000\n',
  );
}
