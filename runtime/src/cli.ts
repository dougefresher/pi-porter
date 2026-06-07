/**
 * Porter CLI — cmd-ts command definitions.
 *
 * Commands:
 *   porter serve                  Start the daemon
 *   porter status                 Daemon health and stats
 *   porter workers                Worker pool snapshot
 *   porter task list              List all scheduled tasks
 *   porter task get <id>          Get task details
 *   porter task create            Create a new scheduled task
 *   porter task delete <id>       Delete a task
 *   porter task pause <id>        Pause a task
 *   porter task resume <id>       Resume a paused task
 *   porter task fire <id>         Trigger a task immediately
 *   porter task runs <id>         Show recent run history
 */

import { binary, command, number, oneOf, option, optional, positional, run, string, subcommands } from 'cmd-ts';

// ---- Socket path ----

function socketPath(): string {
  if (process.env.PORTER_SOCKET) return process.env.PORTER_SOCKET;
  const runtimeDir = process.env.XDG_RUNTIME_DIR;
  if (runtimeDir) return `${runtimeDir}/porter/porter.sock`;
  const stateDir = process.env.PORTER_STATE_DIR || `${process.env.HOME}/.local/state/porter`;
  return `${stateDir}/porter.sock`;
}

// ---- API helpers ----

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
      console.warn('[cli] failed to parse error response body', {
        status: res.status,
        err,
      });
    }
    throw new Error(message);
  }
  if (res.status === 204) return null;
  return body ? JSON.parse(body) : null;
}

function printJson(data: unknown): void {
  console.log(JSON.stringify(data, null, 2));
}

// ---- Task subcommands ----

const taskList = command({
  name: 'list',
  description: 'List all scheduled tasks',
  args: {},
  handler: async () => {
    const tasks = await apiFetch('/api/scheduled-tasks');
    printJson(tasks);
  },
});

const taskGet = command({
  name: 'get',
  description: 'Get task details',
  args: {
    id: positional({ displayName: 'id', type: string }),
  },
  handler: async ({ id }) => {
    const task = await apiFetch(`/api/scheduled-tasks/${encodeURIComponent(id)}`);
    printJson(task);
  },
});

const scheduleType = oneOf(['cron', 'interval', 'once'] as const);

const taskCreate = command({
  name: 'create',
  description: 'Create a new scheduled task',
  examples: [
    {
      description: 'Schedule a daily cron task',
      command:
        "porter task create --id daily-report --schedule cron --value '0 9 * * *' --prompt 'Generate daily report' --session-key main:telegram:default:dm:123456",
    },
    {
      description: 'Create a one-shot task',
      command:
        "porter task create --id cleanup --schedule once --prompt 'Clean up temp files' --session-key main:telegram:default:dm:123456",
    },
    {
      description: 'Create a task with a report target',
      command:
        "porter task create --id monitor --schedule interval --value 3600000 --prompt 'Check health' --session-key main:telegram:default:dm:123456 --report-key main:telegram:default:dm:123456",
    },
  ],
  args: {
    id: option({
      type: string,
      long: 'id',
      description: 'Unique task identifier (slug)',
    }),
    prompt: option({
      type: string,
      long: 'prompt',
      description: 'Prompt to send to the agent',
    }),
    sessionKey: option({
      type: string,
      long: 'session-key',
      description: 'Agent session key (e.g. main:telegram:default:dm:123456)',
    }),
    schedule: option({
      type: scheduleType,
      long: 'schedule',
      short: 's',
      description: 'Schedule type: cron, interval, or once',
    }),
    value: option({
      type: optional(string),
      long: 'value',
      description: 'Schedule value: cron expression or interval in milliseconds (not needed for --schedule once)',
    }),
    name: option({
      type: optional(string),
      long: 'name',
    }),
    reportKey: option({
      type: optional(string),
      long: 'report-key',
    }),
    workdir: option({
      type: optional(string),
      long: 'workdir',
    }),
    preHook: option({
      type: optional(string),
      long: 'pre-hook',
    }),
    postHook: option({
      type: optional(string),
      long: 'post-hook',
    }),
  },
  handler: async (args) => {
    if ((args.schedule === 'cron' || args.schedule === 'interval') && !args.value) {
      throw new Error(`--value is required when --schedule=${args.schedule}`);
    }

    const body: Record<string, unknown> = {
      id: args.id,
      prompt: args.prompt,
      agentSessionKey: args.sessionKey,
      scheduleType: args.schedule,
      scheduleValue: args.schedule === 'once' ? '0' : args.value,
    };
    if (args.name !== undefined) body.name = args.name;
    if (args.reportKey !== undefined) body.reportSessionKey = args.reportKey;
    if (args.workdir !== undefined) body.workdir = args.workdir;
    if (args.preHook !== undefined) body.preHook = args.preHook;
    if (args.postHook !== undefined) body.postHook = args.postHook;

    const task = await apiFetch('/api/scheduled-tasks', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify(body),
    });
    printJson(task);
  },
});

const taskDelete = command({
  name: 'delete',
  description: 'Delete a task',
  args: {
    id: positional({ displayName: 'id', type: string }),
  },
  handler: async ({ id }) => {
    await apiFetch(`/api/scheduled-tasks/${encodeURIComponent(id)}`, {
      method: 'DELETE',
    });
    console.log(`deleted task ${id}`);
  },
});

const taskPause = command({
  name: 'pause',
  description: 'Pause a task',
  args: {
    id: positional({ displayName: 'id', type: string }),
  },
  handler: async ({ id }) => {
    const result = await apiFetch(`/api/scheduled-tasks/${encodeURIComponent(id)}/pause`, { method: 'POST' });
    printJson(result);
  },
});

const taskResume = command({
  name: 'resume',
  description: 'Resume a paused task',
  args: {
    id: positional({ displayName: 'id', type: string }),
  },
  handler: async ({ id }) => {
    const result = await apiFetch(`/api/scheduled-tasks/${encodeURIComponent(id)}/resume`, { method: 'POST' });
    printJson(result);
  },
});

const taskFire = command({
  name: 'fire',
  description: 'Trigger a task immediately',
  args: {
    id: positional({ displayName: 'id', type: string }),
  },
  handler: async ({ id }) => {
    const result = await apiFetch(`/api/scheduled-tasks/${encodeURIComponent(id)}/fire`, { method: 'POST' });
    printJson(result);
  },
});

const taskRuns = command({
  name: 'runs',
  description: 'Show recent run history for a task',
  args: {
    id: positional({ displayName: 'id', type: string }),
    limit: option({
      type: optional(number),
      long: 'limit',
      description: 'Max runs to return (default: 50, max: 500)',
    }),
  },
  handler: async ({ id, limit }) => {
    const query = limit != null ? `?limit=${limit}` : '';
    const runs = await apiFetch(`/api/scheduled-tasks/${encodeURIComponent(id)}/runs${query}`);
    printJson(runs);
  },
});

const task = subcommands({
  name: 'task',
  description: 'Manage scheduled tasks',
  cmds: {
    list: taskList,
    get: taskGet,
    create: taskCreate,
    delete: taskDelete,
    pause: taskPause,
    resume: taskResume,
    fire: taskFire,
    runs: taskRuns,
  },
});

// ---- Top-level commands ----

const statusCmd = command({
  name: 'status',
  description: 'Show daemon health and stats',
  args: {},
  handler: async () => {
    const health = await apiFetch('/api/health');
    printJson(health);
  },
});

const workersCmd = command({
  name: 'workers',
  description: 'Show agent worker pool snapshot',
  args: {},
  handler: async () => {
    const data = await apiFetch('/api/workers');
    printJson(data);
  },
});

const agentWorkerCmd = command({
  name: 'agent-worker',
  description: 'Internal: long-lived agent worker child process (spawned by daemon)',
  args: {},
  handler: async () => {
    await import('./agent/agent-worker.js');
    // agent-worker.ts registers IPC handlers and a keep-alive interval.
    // The process stays alive until the parent disconnects or sends SIGTERM.
  },
});

const serveCmd = command({
  name: 'serve',
  description: 'Start the porter daemon',
  args: {},
  handler: async () => {
    // Dynamic import to avoid loading daemon code for client-only commands.
    const { PorterDaemon } = await import('./daemon.js');
    const { loadConfig } = await import('./config.js');

    const daemon = new PorterDaemon(loadConfig());
    let stopping = false;

    async function stop(signal: string): Promise<void> {
      if (stopping) return;
      stopping = true;
      console.log(`[porter] received ${signal}; shutting down`);
      await daemon.stop();
      process.exit(0);
    }

    process.on('SIGINT', () => {
      stop('SIGINT').catch((error) => {
        console.error('[porter] shutdown failed', error);
        process.exit(1);
      });
    });
    process.on('SIGTERM', () => {
      stop('SIGTERM').catch((error) => {
        console.error('[porter] shutdown failed', error);
        process.exit(1);
      });
    });

    try {
      await daemon.start();
    } catch (error) {
      console.error('[porter] fatal startup error', error);
      await daemon.stop().catch((err) => {
        console.warn('[porter] cleanup after startup failure failed', { err });
      });
      process.exit(1);
    }
  },
});

// ---- Exported entry ----

const app = subcommands({
  name: 'porter',
  version: '0.0.1',
  description: 'Personal assistant daemon',
  cmds: {
    serve: serveCmd,
    status: statusCmd,
    workers: workersCmd,
    'agent-worker': agentWorkerCmd,
    task,
  },
});

export async function runCli(argv: string[]): Promise<void> {
  await run(binary(app), argv);
}
