import type { PostgresBus } from '../bus/postgres-bus.js';
import type { ScheduledTaskStore } from '../db/scheduled-task-store.js';
import type { SessionStore } from '../db/session-store.js';
import { parseSessionKey } from '../routing/session-key.js';
import type { ScheduledTask } from './types.js';

type TimerHandle = { kind: 'cron'; stop: () => void } | { kind: 'timeout'; timer: ReturnType<typeof setTimeout> };

export type SchedulerRegistryOptions = {
  bus: PostgresBus;
  sessions: SessionStore;
  store: ScheduledTaskStore;
};

export class SchedulerRegistry {
  private bus: PostgresBus;
  private handles = new Map<string, TimerHandle>();
  private sessions: SessionStore;
  private started = false;
  private store: ScheduledTaskStore;

  constructor(options: SchedulerRegistryOptions) {
    this.bus = options.bus;
    this.sessions = options.sessions;
    this.store = options.store;
  }

  async start(): Promise<void> {
    if (this.started) return;

    const tasks = await this.store.listActive();
    for (const task of tasks) {
      this.register(task);
    }
    this.started = true;
    console.log('[scheduler] registry started', { activeTasks: tasks.length });
  }

  stop(): void {
    this.started = false;
    for (const [taskId, handle] of this.handles.entries()) {
      this.disarm(taskId, handle);
    }
    this.handles.clear();
    console.log('[scheduler] registry stopped');
  }

  /**
   * Immediately fire a scheduled task by publishing an inbound event.
   * Does not affect the existing schedule timer.
   */
  async fireNow(taskId: string): Promise<{ ok: boolean; error?: string }> {
    if (!this.started) return { ok: false, error: 'scheduler not started' };

    const task = await this.store.getById(taskId);
    if (!task) return { ok: false, error: 'task not found' };
    if (task.status !== 'active') return { ok: false, error: `task is ${task.status}, not active` };

    const parsed = parseSessionKey(task.agentSessionKey);
    if (!parsed) return { ok: false, error: `invalid agent session key: ${task.agentSessionKey}` };

    await this.sessions.ensureSession(task.agentSessionKey, parsed);

    await this.bus.publishInbound({
      sessionKey: task.agentSessionKey,
      channel: 'scheduler',
      accountId: 'default',
      chatId: task.id,
      senderId: 'scheduler',
      content: task.prompt,
      metadata: {
        scheduled: true,
        taskId: task.id,
        taskName: task.name,
        reportSessionKey: task.reportSessionKey,
        firedManually: true,
        ...(task.workdir ? { workdir: task.workdir } : {}),
      },
    });

    console.log('[scheduler] manual fire', { taskId: task.id, name: task.name });
    return { ok: true };
  }

  async refresh(taskId: string): Promise<void> {
    if (!this.started) return;
    this.disarm(taskId);
    const task = await this.store.getById(taskId);
    if (!task || task.status !== 'active') return;
    this.register(task);
  }

  async notifyTaskComplete(taskId: string): Promise<void> {
    console.log('[scheduler] task complete notification', { taskId });
    const task = await this.store.getById(taskId);
    if (!task) return;
    if (task.scheduleType === 'cron') return;
    await this.refresh(taskId);
  }

  private register(task: ScheduledTask): void {
    this.disarm(task.id);
    console.log('[scheduler] registering task', {
      taskId: task.id,
      name: task.name,
      scheduleType: task.scheduleType,
      scheduleValue: task.scheduleValue,
      nextRun: task.nextRun,
    });

    if (task.scheduleType === 'cron') {
      try {
        const job = Bun.cron(task.scheduleValue, () => {
          this.fire(task.id).catch((error) => {
            console.error('[scheduler] task fire failed', { taskId: task.id, error });
          });
        });
        this.handles.set(task.id, { kind: 'cron', stop: () => job.stop() });
      } catch (error) {
        console.error('[scheduler] failed to register cron task', { taskId: task.id, error });
      }
      return;
    }

    if (task.scheduleType === 'once') {
      if (!task.nextRun) return;
      const delayMs = Math.max(0, task.nextRun.getTime() - Date.now());
      const timer = setTimeout(() => {
        this.fire(task.id).catch((error) => {
          console.error('[scheduler] task fire failed', { taskId: task.id, error });
        });
      }, delayMs);
      this.handles.set(task.id, { kind: 'timeout', timer });
      return;
    }

    if (task.scheduleType === 'interval') {
      const ms = Number.parseInt(task.scheduleValue, 10);
      if (!Number.isFinite(ms) || ms <= 0) {
        console.error('[scheduler] invalid interval task', { taskId: task.id, scheduleValue: task.scheduleValue });
        return;
      }
      const timer = setTimeout(() => {
        this.fire(task.id).catch((error) => {
          console.error('[scheduler] task fire failed', { taskId: task.id, error });
        });
      }, ms);
      this.handles.set(task.id, { kind: 'timeout', timer });
    }
  }

  private disarm(taskId: string, handle = this.handles.get(taskId)): void {
    if (!handle) return;
    console.log('[scheduler] disarming task', { taskId });
    if (handle.kind === 'cron') {
      handle.stop();
    } else {
      clearTimeout(handle.timer);
    }
    this.handles.delete(taskId);
  }

  private async fire(taskId: string): Promise<void> {
    if (!this.started) return;

    let task: ScheduledTask | null = null;
    try {
      task = await this.store.getById(taskId);
      if (!task || task.status !== 'active') {
        this.disarm(taskId);
        return;
      }

      const parsed = parseSessionKey(task.agentSessionKey);
      if (!parsed) {
        console.error('[scheduler] invalid agent session key', {
          taskId: task.id,
          agentSessionKey: task.agentSessionKey,
        });
        await this.rearmIntervalOnFireFailure(task);
        return;
      }

      await this.sessions.ensureSession(task.agentSessionKey, parsed);

      console.log('[scheduler] firing task', { taskId: task.id, name: task.name, scheduleType: task.scheduleType });

      await this.bus.publishInbound({
        sessionKey: task.agentSessionKey,
        channel: 'scheduler',
        accountId: 'default',
        chatId: task.id,
        senderId: 'scheduler',
        content: task.prompt,
        metadata: {
          scheduled: true,
          taskId: task.id,
          taskName: task.name,
          reportSessionKey: task.reportSessionKey,
          ...(task.workdir ? { workdir: task.workdir } : {}),
        },
      });
    } catch (error) {
      console.error('[scheduler] task fire failed', { taskId, error });
      await this.rearmIntervalOnFireFailure(task);
    }
  }

  private async rearmIntervalOnFireFailure(task: ScheduledTask | null): Promise<void> {
    if (!task || task.scheduleType !== 'interval') return;
    await this.rearmIntervalTask(task.id);
  }

  private async rearmIntervalTask(taskId: string): Promise<void> {
    if (!this.started) return;
    this.disarm(taskId);
    const task = await this.store.getById(taskId);
    if (!task || task.status !== 'active' || task.scheduleType !== 'interval') return;
    this.register(task);
  }
}
