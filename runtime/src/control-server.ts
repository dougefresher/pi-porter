/**
 * UNIX socket control plane for the porter daemon.
 *
 * Exposes a REST API over HTTP on a directly-bound UNIX domain socket.
 * Systemd manages socket directory lifecycle via RuntimeDirectory=porter-%i.
 *
 * Routes:
 *   GET  /api/health
 *   GET  /api/scheduled-tasks
 *   GET  /api/scheduled-tasks/:id
 *   POST /api/scheduled-tasks
 *   DELETE /api/scheduled-tasks/:id
 *   POST /api/scheduled-tasks/:id/pause
 *   POST /api/scheduled-tasks/:id/resume
 *   POST /api/scheduled-tasks/:id/fire
 *   GET  /api/scheduled-tasks/:id/runs
 *   GET  /api/workers
 */

import type { BunRequest } from 'bun';
import type { SessionWorkerPool } from './agent/worker-pool.js';
import type { ScheduledTaskStore } from './db/scheduled-task-store.js';
import type { SessionStore } from './db/session-store.js';
import { parseSessionKey } from './routing/session-key.js';
import type { SchedulerRegistry } from './scheduler/registry.js';
import type { NewScheduledTask } from './scheduler/types.js';

// ---- Types ----

export type ControlServerOptions = {
  scheduler: SchedulerRegistry;
  taskStore: ScheduledTaskStore;
  sessionStore: SessionStore;
  workerPool?: SessionWorkerPool;
};

// ---- Helpers ----

function json(data: unknown, status = 200): Response {
  return new Response(JSON.stringify(data), {
    status,
    headers: { 'content-type': 'application/json' },
  });
}

function errorJson(message: string, status: number): Response {
  return json({ error: message }, status);
}

// ---- ControlServer ----

export class ControlServer {
  private server: ReturnType<typeof Bun.serve> | null = null;
  private socketPath: string | null = null;
  private scheduler: SchedulerRegistry;
  private taskStore: ScheduledTaskStore;
  private sessionStore: SessionStore;
  private workerPool: SessionWorkerPool | undefined;

  constructor(options: ControlServerOptions) {
    this.scheduler = options.scheduler;
    this.taskStore = options.taskStore;
    this.sessionStore = options.sessionStore;
    this.workerPool = options.workerPool;
  }

  async start(): Promise<void> {
    const socketPath =
      process.env.PORTER_SOCKET ||
      (() => {
        const runtimeDir = process.env.XDG_RUNTIME_DIR;
        const stateDir = process.env.PORTER_STATE_DIR || `${process.env.HOME}/.local/state/porter`;
        const base = runtimeDir ? `${runtimeDir}/porter` : stateDir;
        return `${base}/porter.sock`;
      })();

    try {
      await Bun.file(socketPath).delete();
    } catch (err) {
      console.debug('[control-server] stale socket cleanup failed', { path: socketPath, err });
    }

    this.socketPath = socketPath;
    console.log('[control-server] binding on unix socket', { path: socketPath });
    this.server = Bun.serve({
      unix: socketPath,
      routes: {
        '/api/health': {
          GET: () => this.handleHealth(),
        },
        '/api/scheduled-tasks': {
          GET: () => this.handleListTasks(),
          POST: (req) => this.handleCreateTask(req),
        },
        '/api/scheduled-tasks/:id': {
          GET: (req) => this.handleGetTask(req),
          DELETE: (req) => this.handleDeleteTask(req),
        },
        '/api/scheduled-tasks/:id/pause': {
          POST: (req) => this.handlePauseTask(req),
        },
        '/api/scheduled-tasks/:id/resume': {
          POST: (req) => this.handleResumeTask(req),
        },
        '/api/scheduled-tasks/:id/fire': {
          POST: (req) => this.handleFireTask(req),
        },
        '/api/scheduled-tasks/:id/runs': {
          GET: (req) => this.handleGetTaskRuns(req),
        },
        '/api/workers': {
          GET: () => this.handleWorkers(),
        },
      },
      error: (err: Error) => {
        console.error('[control-server] unhandled error', { error: err });
        return errorJson('internal server error', 500);
      },
    });

    console.log('[control-server] started');
  }

  async stop(): Promise<void> {
    if (this.server) {
      await this.server.stop();
      this.server = null;
    }
    if (this.socketPath) {
      const path = this.socketPath;
      await Bun.file(path)
        .delete()
        .catch((err) => {
          console.warn('[control-server] socket unlink on stop failed', { path, err });
        });
      this.socketPath = null;
    }
    console.log('[control-server] stopped');
  }

  // ---- Route handlers ----

  private handleHealth(): Response {
    const workerCount = this.workerPool?.size ?? 'n/a';
    return json({
      status: 'ok',
      uptime: process.uptime(),
      pid: process.pid,
      workers: workerCount,
    });
  }

  private async handleListTasks(): Promise<Response> {
    const tasks = await this.taskStore.listAll();
    return json(tasks);
  }

  private async handleGetTask(req: BunRequest<'/api/scheduled-tasks/:id'>): Promise<Response> {
    const task = await this.taskStore.getById(req.params.id);
    if (!task) return errorJson('task not found', 404);
    return json(task);
  }

  private async handleCreateTask(req: BunRequest<'/api/scheduled-tasks'>): Promise<Response> {
    let body: unknown;
    try {
      body = await req.json();
    } catch {
      return errorJson('invalid JSON body', 400);
    }

    const input = body as Record<string, unknown>;
    const validation = validateCreateTask(input);
    if (validation) return errorJson(validation, 400);

    const newTask: NewScheduledTask = {
      id: String(input.id),
      name: typeof input.name === 'string' ? input.name : null,
      prompt: String(input.prompt),
      agentSessionKey: String(input.agentSessionKey),
      reportSessionKey: typeof input.reportSessionKey === 'string' ? input.reportSessionKey : null,
      workdir: typeof input.workdir === 'string' ? input.workdir : null,
      preHook: typeof input.preHook === 'string' ? input.preHook : null,
      postHook: typeof input.postHook === 'string' ? input.postHook : null,
      scheduleType: input.scheduleType as NewScheduledTask['scheduleType'],
      scheduleValue: String(input.scheduleValue),
    };

    const parsed = parseSessionKey(newTask.agentSessionKey);
    if (!parsed) return errorJson('invalid agentSessionKey format', 400);
    await this.sessionStore.ensureSession(newTask.agentSessionKey, parsed);
    if (newTask.reportSessionKey) {
      const reportParsed = parseSessionKey(newTask.reportSessionKey);
      if (!reportParsed) return errorJson('invalid reportSessionKey format', 400);
      await this.sessionStore.ensureSession(newTask.reportSessionKey, reportParsed);
    }

    try {
      const task = await this.taskStore.create(newTask);
      await this.scheduler.refresh(task.id);
      console.log('[control-server] created task', { taskId: task.id, name: task.name });
      return json(task, 201);
    } catch (err: unknown) {
      const msg = err instanceof Error ? err.message : String(err);
      if (msg.includes('duplicate key') || msg.includes('violates unique constraint')) {
        return errorJson(`task id '${newTask.id}' already exists`, 409);
      }
      console.error('[control-server] create task failed', { taskId: newTask.id, error: msg });
      return errorJson('failed to create task', 500);
    }
  }

  private async handleDeleteTask(req: BunRequest<'/api/scheduled-tasks/:id'>): Promise<Response> {
    const { id } = req.params;

    const task = await this.taskStore.getById(id);
    if (!task) return errorJson('task not found', 404);

    await this.taskStore.setStatus(id, 'paused');
    await this.scheduler.refresh(id);

    const deleted = await this.taskStore.delete(id);
    if (!deleted) return errorJson('task not found', 404);
    console.log('[control-server] deleted task', { taskId: id });
    return new Response(null, { status: 204 });
  }

  private async handlePauseTask(req: BunRequest<'/api/scheduled-tasks/:id/pause'>): Promise<Response> {
    const { id } = req.params;
    const task = await this.taskStore.getById(id);
    if (!task) return errorJson('task not found', 404);
    if (task.status !== 'active') {
      return errorJson(`task is already ${task.status}`, 409);
    }

    await this.taskStore.setStatus(id, 'paused');
    await this.scheduler.refresh(id);
    console.log('[control-server] paused task', { taskId: id });
    return json({ id, status: 'paused' });
  }

  private async handleResumeTask(req: BunRequest<'/api/scheduled-tasks/:id/resume'>): Promise<Response> {
    const { id } = req.params;
    const task = await this.taskStore.getById(id);
    if (!task) return errorJson('task not found', 404);
    if (task.status !== 'paused') {
      return errorJson(`task is ${task.status}, not paused`, 409);
    }

    await this.taskStore.setStatus(id, 'active');
    await this.scheduler.refresh(id);
    console.log('[control-server] resumed task', { taskId: id });
    return json({ id, status: 'active' });
  }

  private async handleFireTask(req: BunRequest<'/api/scheduled-tasks/:id/fire'>): Promise<Response> {
    const { id } = req.params;
    const result = await this.scheduler.fireNow(id);
    if (!result.ok) {
      return errorJson(result.error ?? 'failed to fire task', result.error === 'task not found' ? 404 : 409);
    }
    return json({ id, fired: true });
  }

  private async handleGetTaskRuns(req: BunRequest<'/api/scheduled-tasks/:id/runs'>): Promise<Response> {
    const { id } = req.params;
    const url = new URL(req.url);
    const raw = Number.parseInt(url.searchParams.get('limit') ?? '50', 10);
    const limit = Number.isFinite(raw) && raw > 0 ? Math.min(raw, 500) : 50;
    const runs = await this.taskStore.getRuns(id, limit);
    return json(runs);
  }

  private handleWorkers(): Response {
    if (!this.workerPool) {
      return json({ workers: 'unavailable' });
    }
    return json({
      count: this.workerPool.size,
      snapshot: this.workerPool.snapshot(),
    });
  }
}

// ---- Validation ----

const VALID_SCHEDULE_TYPES = new Set(['cron', 'interval', 'once']);

function validateCreateTask(input: Record<string, unknown>): string | null {
  if (typeof input.id !== 'string' || !input.id.trim()) {
    return 'id is required and must be a non-empty string';
  }
  if (typeof input.prompt !== 'string' || !input.prompt.trim()) {
    return 'prompt is required and must be a non-empty string';
  }
  if (typeof input.agentSessionKey !== 'string' || !input.agentSessionKey.trim()) {
    return 'agentSessionKey is required and must be a non-empty string';
  }
  if (typeof input.scheduleType !== 'string' || !VALID_SCHEDULE_TYPES.has(input.scheduleType)) {
    return 'scheduleType must be one of: cron, interval, once';
  }
  if (typeof input.scheduleValue !== 'string' || !input.scheduleValue.trim()) {
    return 'scheduleValue is required and must be a non-empty string';
  }
  if (input.reportSessionKey !== undefined && input.reportSessionKey !== null) {
    if (typeof input.reportSessionKey !== 'string' || !input.reportSessionKey.trim()) {
      return 'reportSessionKey must be a non-empty string or null';
    }
  }
  if (input.preHook !== undefined && input.preHook !== null && typeof input.preHook !== 'string') {
    return 'preHook must be a string or null';
  }
  if (input.postHook !== undefined && input.postHook !== null && typeof input.postHook !== 'string') {
    return 'postHook must be a string or null';
  }
  if (input.workdir !== undefined && input.workdir !== null && typeof input.workdir !== 'string') {
    return 'workdir must be a string or null';
  }
  return null;
}
