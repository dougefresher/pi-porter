import { archiveAndClearPiSession } from '../agent/archive-pi-session.js';
import type { AgentRunner } from '../agent/runner.js';
import type { PostgresBus } from '../bus/postgres-bus.js';
import type { InboundEvent } from '../bus/types.js';
import { roomIdForInbound } from '../channels/room-id.js';
import type { ChannelWorkdirStore } from '../db/channel-workdir-store.js';
import type { ScheduledTaskStore } from '../db/scheduled-task-store.js';
import type { SessionArchiveStore } from '../db/session-archive-store.js';
import { SessionStore } from '../db/session-store.js';
import { TranscriptStore } from '../db/transcript-store.js';
import { appendCronLog, computeNextRun, resolveOutboundFromSessionKey, runHook } from '../scheduler/index.js';
import type { SchedulerRegistry } from '../scheduler/registry.js';
import type { ScheduledTask } from '../scheduler/types.js';

export type InboundWorkerOptions = {
  stateDir: string;
  sessionRoot: string;
  sessionArchiveStore: SessionArchiveStore;
  scheduledTasks: ScheduledTaskStore;
  scheduler?: SchedulerRegistry;
  workdirStore?: ChannelWorkdirStore;
};

function readWorkdir(metadata: Record<string, unknown>): string | undefined {
  const workdir = metadata.workdir;
  if (typeof workdir !== 'string') return undefined;
  const trimmed = workdir.trim();
  return trimmed || undefined;
}

function readScheduledMetadata(metadata: Record<string, unknown>): {
  isScheduled: boolean;
  taskId: string | null;
  taskName: string | null;
  reportSessionKey: string | null;
} {
  return {
    isScheduled: metadata.scheduled === true,
    taskId: typeof metadata.taskId === 'string' ? metadata.taskId : null,
    taskName: typeof metadata.taskName === 'string' ? metadata.taskName : null,
    reportSessionKey: typeof metadata.reportSessionKey === 'string' ? metadata.reportSessionKey : null,
  };
}

export class InboundWorker {
  private stopped = false;
  private running: Promise<void> | null = null;
  private sessionLocks = new Set<string>();

  private agent: AgentRunner;
  private bus: PostgresBus;
  private options: InboundWorkerOptions;
  private sessions: SessionStore;
  private transcripts: TranscriptStore;

  constructor(
    bus: PostgresBus,
    sessions: SessionStore,
    transcripts: TranscriptStore,
    agent: AgentRunner,
    options: InboundWorkerOptions,
  ) {
    this.bus = bus;
    this.sessions = sessions;
    this.transcripts = transcripts;
    this.agent = agent;
    this.options = options;
  }

  start(): void {
    if (this.running && !this.stopped) return;
    this.stopped = false;
    this.running = this.loop().finally(() => {
      this.running = null;
    });
  }

  async stop(): Promise<void> {
    this.stopped = true;
    this.agent.shutdown?.();
    await this.running;
  }

  private async loop(): Promise<void> {
    while (!this.stopped) {
      try {
        const event = await this.bus.claimInbound();
        if (!event) {
          await Bun.sleep(500);
          continue;
        }
        await this.process(event);
      } catch (error) {
        console.error('[inbound-worker] loop error', { error });
        await Bun.sleep(1_000);
      }
    }
  }

  private async process(event: InboundEvent): Promise<void> {
    console.log('[inbound-worker] process start', {
      inboundId: event.id,
      sessionKey: event.sessionKey,
      channel: event.channel,
      chatId: event.chatId,
      contentLength: event.content.length,
      scheduled: event.metadata.scheduled === true,
    });
    while (!this.stopped && this.sessionLocks.has(event.sessionKey)) {
      await Bun.sleep(50);
    }
    if (this.stopped) return;

    this.sessionLocks.add(event.sessionKey);
    const startedAt = Date.now();
    const scheduled = readScheduledMetadata(event.metadata);

    let scheduledTask: ScheduledTask | null = null;

    try {
      if (scheduled.isScheduled && scheduled.taskId) {
        scheduledTask = await this.options.scheduledTasks.getById(scheduled.taskId);
      }
      if (scheduledTask?.preHook) {
        const preHookOk = await this.runPreHook(scheduledTask, event.id);
        if (!preHookOk) {
          await this.bus.markInboundFailed(event.id, 'Pre-hook failed');
          await this.archiveScheduledSession(event.sessionKey, scheduled.taskId);
          return;
        }
      }

      await this.transcripts.append({
        sessionKey: event.sessionKey,
        inboundId: event.id,
        role: 'user',
        content: event.content,
        payload: { metadata: event.metadata },
      });

      console.log('[inbound-worker] running agent', {
        inboundId: event.id,
        sessionKey: event.sessionKey,
        inputLength: event.content.length,
      });

      let workdir = readWorkdir(event.metadata);
      if (!workdir && this.options.workdirStore) {
        const roomId = roomIdForInbound(event);
        const stored = await this.options.workdirStore.get(roomId);
        if (stored) {
          workdir = stored;
          console.log('[inbound-worker] using stored workdir', {
            inboundId: event.id,
            roomId,
          });
        }
      }

      const reply = await this.agent.run({
        sessionKey: event.sessionKey,
        inboundId: event.id,
        text: event.content,
        metadata: event.metadata,
        cwd: workdir,
      });
      console.log('[inbound-worker] agent reply received', {
        inboundId: event.id,
        sessionKey: event.sessionKey,
        replyLength: reply.length,
        durationMs: Date.now() - startedAt,
      });
      await this.transcripts.append({
        sessionKey: event.sessionKey,
        inboundId: event.id,
        role: 'assistant',
        content: reply,
      });

      if (scheduled.isScheduled) {
        console.log('[inbound-worker] routing scheduled reply', {
          inboundId: event.id,
          taskId: scheduled.taskId,
          reportSessionKey: scheduled.reportSessionKey,
        });
        await appendCronLog(this.options.stateDir, {
          taskId: scheduled.taskId ?? 'unknown',
          taskName: scheduled.taskName,
          status: 'success',
          durationMs: Date.now() - startedAt,
          prompt: event.content,
          result: reply,
        });

        const reportTarget = scheduled.reportSessionKey
          ? resolveOutboundFromSessionKey(scheduled.reportSessionKey)
          : null;

        if (scheduled.reportSessionKey && !reportTarget) {
          console.warn('[inbound-worker] unsupported report session key; falling back to event target', {
            reportSessionKey: scheduled.reportSessionKey,
            taskId: scheduled.taskId,
          });
        }

        const outboundSessionKey = reportTarget ? scheduled.reportSessionKey! : event.sessionKey;
        const outboundChannel = reportTarget?.channel ?? event.channel;
        const outboundChatId = reportTarget?.chatId ?? event.chatId;
        console.log('[inbound-worker] publishing scheduled outbound', {
          inboundId: event.id,
          outboundSessionKey,
          outboundChannel,
          outboundChatId,
        });
        await this.bus.publishOutbound({
          inboundId: event.id,
          sessionKey: outboundSessionKey,
          channel: outboundChannel,
          accountId: reportTarget?.accountId ?? event.accountId,
          chatId: outboundChatId,
          content: reply,
          metadata: {
            inboundId: event.id,
            scheduled: true,
            taskId: scheduled.taskId,
          },
        });

        if (scheduled.taskId) {
          await this.recordScheduledSuccess(scheduled.taskId, event.id, startedAt, reply);
          await this.options.scheduler?.notifyTaskComplete(scheduled.taskId);
        }

        if (scheduledTask?.postHook) {
          await this.runPostHook(scheduledTask);
        }

        await this.archiveScheduledSession(event.sessionKey, scheduled.taskId);
      } else {
        console.log('[inbound-worker] publishing direct reply outbound', {
          inboundId: event.id,
          sessionKey: event.sessionKey,
          channel: event.channel,
          chatId: event.chatId,
        });
        const threadEventId =
          typeof event.metadata.threadEventId === 'string' ? event.metadata.threadEventId : undefined;
        const replyToEventId =
          event.channel === 'matrix' && threadEventId
            ? undefined
            : typeof event.metadata.replyToEventId === 'string'
              ? event.metadata.replyToEventId
              : undefined;

        await this.bus.publishOutbound({
          inboundId: event.id,
          sessionKey: event.sessionKey,
          channel: event.channel,
          accountId: event.accountId,
          chatId: event.chatId,
          content: reply,
          metadata: {
            inboundId: event.id,
            ...(threadEventId ? { threadEventId } : {}),
            ...(replyToEventId ? { replyToEventId } : {}),
          },
        });
      }

      await this.sessions.bumpMessageCount(event.sessionKey, 2);
      await this.bus.markInboundDone(event.id);
      console.log('[inbound-worker] process done', {
        inboundId: event.id,
        sessionKey: event.sessionKey,
        durationMs: Date.now() - startedAt,
      });
    } catch (error) {
      try {
        if (scheduled.isScheduled) {
          if (scheduled.taskId) {
            await appendCronLog(this.options.stateDir, {
              taskId: scheduled.taskId,
              taskName: scheduled.taskName,
              status: 'error',
              durationMs: Date.now() - startedAt,
              prompt: event.content,
              error,
            });
            await this.recordScheduledFailure(scheduled.taskId, event.id, startedAt, error);
            await this.options.scheduler?.notifyTaskComplete(scheduled.taskId);
          }
          if (scheduledTask?.postHook) {
            await this.runPostHook(scheduledTask);
          }
          await this.archiveScheduledSession(event.sessionKey, scheduled.taskId);
        }
      } catch (bookkeepingError) {
        console.error('[inbound-worker] scheduled failure bookkeeping failed', {
          inboundId: event.id,
          taskId: scheduled.taskId,
          bookkeepingError,
          originalError: error,
        });
      } finally {
        await this.bus.markInboundFailed(event.id, error);
      }
    } finally {
      this.sessionLocks.delete(event.sessionKey);
    }
  }

  private async archiveScheduledSession(sessionKey: string, taskId: string | null): Promise<void> {
    try {
      const archived = await archiveAndClearPiSession({
        sessionArchiveStore: this.options.sessionArchiveStore,
        sessionRoot: this.options.sessionRoot,
        sessionKey,
        reason: 'scheduled_run',
      });
      if (archived) {
        console.log('[inbound-worker] archived scheduled session', { sessionKey, taskId });
      }
    } catch (error) {
      console.error('[inbound-worker] scheduled session archive failed', { sessionKey, taskId, error });
    }
  }

  private async recordScheduledSuccess(
    taskId: string,
    inboundId: number,
    startedAt: number,
    reply: string,
  ): Promise<void> {
    const task = await this.options.scheduledTasks.getById(taskId);
    if (!task) return;

    const nextRun = computeNextRun(task.scheduleType, task.scheduleValue);
    const lastResult = reply.slice(0, 200) || 'Completed';
    await this.options.scheduledTasks.updateAfterRun(taskId, {
      nextRun,
      lastResult,
      status: nextRun == null ? 'completed' : undefined,
    });
    await this.options.scheduledTasks.logRun({
      taskId,
      inboundId,
      durationMs: Date.now() - startedAt,
      status: 'success',
      result: reply,
    });
  }

  private async recordScheduledFailure(
    taskId: string,
    inboundId: number,
    startedAt: number,
    error: unknown,
  ): Promise<void> {
    const task = await this.options.scheduledTasks.getById(taskId);
    if (!task) return;

    const message = error instanceof Error ? error.stack || error.message : String(error);
    const nextRun = computeNextRun(task.scheduleType, task.scheduleValue);
    await this.options.scheduledTasks.updateAfterRun(taskId, {
      nextRun,
      lastResult: `Error: ${message.slice(0, 200)}`,
      status: nextRun == null ? 'completed' : undefined,
    });
    await this.options.scheduledTasks.logRun({
      taskId,
      inboundId,
      durationMs: Date.now() - startedAt,
      status: 'error',
      error: message,
    });
  }

  private async runPreHook(task: ScheduledTask, inboundId: number): Promise<boolean> {
    console.log('[inbound-worker] running pre-hook', { taskId: task.id, preHook: task.preHook });
    const hookStart = Date.now();
    try {
      const result = await runHook(task.preHook!, task.workdir);
      const durationMs = Date.now() - hookStart;
      if (result.exitCode !== 0) {
        console.error('[inbound-worker] pre-hook failed (aborting task)', {
          taskId: task.id,
          exitCode: result.exitCode,
          stdout: result.stdout,
          stderr: result.stderr,
          durationMs,
        });
        await appendCronLog(this.options.stateDir, {
          taskId: task.id,
          taskName: task.name,
          status: 'error',
          durationMs,
          prompt: `[pre-hook] ${task.preHook}`,
          error: `exit=${result.exitCode} stderr=${result.stderr || result.stdout}`,
        });
        await this.options.scheduledTasks.logRun({
          taskId: task.id,
          inboundId,
          durationMs,
          status: 'error',
          error: `Pre-hook failed (exit ${result.exitCode}): ${result.stderr || result.stdout}`,
        });
        const nextRun = computeNextRun(task.scheduleType, task.scheduleValue);
        await this.options.scheduledTasks.updateAfterRun(task.id, {
          nextRun,
          lastResult: `Pre-hook failed (exit ${result.exitCode})`,
          status: nextRun == null ? 'completed' : undefined,
        });
        await this.options.scheduler?.notifyTaskComplete(task.id);
        return false;
      }
      console.log('[inbound-worker] pre-hook succeeded', { taskId: task.id, durationMs });
      return true;
    } catch (error) {
      const durationMs = Date.now() - hookStart;
      const message = error instanceof Error ? error.message : String(error);
      console.error('[inbound-worker] pre-hook error (aborting task)', { taskId: task.id, error: message, durationMs });
      await appendCronLog(this.options.stateDir, {
        taskId: task.id,
        taskName: task.name,
        status: 'error',
        durationMs,
        prompt: `[pre-hook] ${task.preHook}`,
        error: message,
      });
      await this.options.scheduledTasks.logRun({
        taskId: task.id,
        inboundId,
        durationMs,
        status: 'error',
        error: `Pre-hook error: ${message}`,
      });
      const nextRun = computeNextRun(task.scheduleType, task.scheduleValue);
      await this.options.scheduledTasks.updateAfterRun(task.id, {
        nextRun,
        lastResult: `Pre-hook error: ${message.slice(0, 200)}`,
        status: nextRun == null ? 'completed' : undefined,
      });
      await this.options.scheduler?.notifyTaskComplete(task.id);
      return false;
    }
  }

  private async runPostHook(task: ScheduledTask): Promise<void> {
    console.log('[inbound-worker] running post-hook', { taskId: task.id, postHook: task.postHook });
    const hookStart = Date.now();
    try {
      const result = await runHook(task.postHook!, task.workdir);
      const durationMs = Date.now() - hookStart;
      if (result.exitCode !== 0) {
        console.error('[inbound-worker] post-hook failed (non-fatal)', {
          taskId: task.id,
          exitCode: result.exitCode,
          stdout: result.stdout,
          stderr: result.stderr,
          durationMs,
        });
      } else {
        console.log('[inbound-worker] post-hook succeeded', { taskId: task.id, durationMs });
      }
    } catch (error) {
      const durationMs = Date.now() - hookStart;
      console.error('[inbound-worker] post-hook error (non-fatal)', {
        taskId: task.id,
        error: error instanceof Error ? error.message : String(error),
        durationMs,
      });
    }
  }
}
