import { computeNextRun } from '../scheduler/compute-next-run.js';
import type {
  NewScheduledTask,
  NewScheduledTaskRun,
  ScheduledTask,
  ScheduledTaskRun,
  TaskStatus,
  UpdateScheduledTaskAfterRun,
} from '../scheduler/types.js';
import type { Db } from './client.js';

function mapTask(row: Record<string, unknown>): ScheduledTask {
  return {
    id: String(row.id),
    name: (row.name as string | null) ?? null,
    prompt: String(row.prompt),
    agentSessionKey: String(row.agent_session_key),
    reportSessionKey: (row.report_session_key as string | null) ?? null,
    workdir: (row.workdir as string | null) ?? null,
    preHook: (row.pre_hook as string | null) ?? null,
    postHook: (row.post_hook as string | null) ?? null,
    scheduleType: row.schedule_type as ScheduledTask['scheduleType'],
    scheduleValue: String(row.schedule_value),
    nextRun: (row.next_run as Date | null) ?? null,
    lastRun: (row.last_run as Date | null) ?? null,
    lastResult: (row.last_result as string | null) ?? null,
    status: row.status as TaskStatus,
    createdAt: row.created_at as Date,
    updatedAt: row.updated_at as Date,
  };
}

export class ScheduledTaskStore {
  private db: Db;

  constructor(db: Db) {
    this.db = db;
  }

  async getById(id: string): Promise<ScheduledTask | null> {
    const rows = (await this.db`
      select * from scheduled_tasks where id = ${id}
    `) as Record<string, unknown>[];
    const row = rows[0];
    return row ? mapTask(row) : null;
  }

  async listActive(): Promise<ScheduledTask[]> {
    const rows = (await this.db`
      select * from scheduled_tasks
      where status = 'active'
      order by created_at, id
    `) as Record<string, unknown>[];
    return rows.map(mapTask);
  }

  async updateAfterRun(id: string, update: UpdateScheduledTaskAfterRun): Promise<void> {
    const nextStatus = update.status ?? (update.nextRun == null ? 'completed' : 'active');
    const explicitStatus = update.status ?? null;
    await this.db`
      update scheduled_tasks
      set
        next_run = ${update.nextRun},
        last_run = now(),
        last_result = ${update.lastResult},
        status = case
          when status = 'paused' and ${explicitStatus} is null then status
          else ${nextStatus}::scheduled_task_status_t
        end,
        updated_at = now()
      where id = ${id}
    `;
  }

  async logRun(run: NewScheduledTaskRun): Promise<void> {
    await this.db`
      insert into scheduled_task_runs (
        task_id,
        inbound_id,
        duration_ms,
        status,
        result,
        error
      ) values (
        ${run.taskId},
        ${run.inboundId ?? null},
        ${run.durationMs},
        ${run.status},
        ${run.result ?? null},
        ${run.error ?? null}
      )
    `;
  }

  async listAll(): Promise<ScheduledTask[]> {
    const rows = (await this.db`
      select * from scheduled_tasks
      order by created_at, id
    `) as Record<string, unknown>[];
    return rows.map(mapTask);
  }

  async create(input: NewScheduledTask): Promise<ScheduledTask> {
    const nextRun = computeNextRun(input.scheduleType, input.scheduleValue);
    const rows = (await this.db`
      insert into scheduled_tasks (
        id, name, prompt,
        agent_session_key, report_session_key,
        workdir, pre_hook, post_hook,
        schedule_type, schedule_value,
        next_run, status
      ) values (
        ${input.id}, ${input.name ?? null}, ${input.prompt},
        ${input.agentSessionKey}, ${input.reportSessionKey ?? null},
        ${input.workdir ?? null}, ${input.preHook ?? null}, ${input.postHook ?? null},
        ${input.scheduleType}, ${input.scheduleValue},
        ${nextRun}, 'active'
      )
      returning *
    `) as Record<string, unknown>[];
    return mapTask(rows[0]!);
  }

  async delete(id: string): Promise<boolean> {
    const result = await this.db`
      delete from scheduled_tasks where id = ${id}
    `;
    return result.count > 0;
  }

  async setStatus(id: string, status: TaskStatus): Promise<boolean> {
    const result = await this.db`
      update scheduled_tasks
      set status = ${status}::scheduled_task_status_t, updated_at = now()
      where id = ${id}
    `;
    return result.count > 0;
  }

  async getRuns(taskId: string, limit = 50): Promise<ScheduledTaskRun[]> {
    const rows = (await this.db`
      select * from scheduled_task_runs
      where task_id = ${taskId}
      order by run_at desc, id desc
      limit ${limit}
    `) as Record<string, unknown>[];
    return rows.map(
      (row): ScheduledTaskRun => ({
        id: Number(row.id),
        taskId: String(row.task_id),
        inboundId: row.inbound_id != null ? Number(row.inbound_id) : null,
        runAt: row.run_at as Date,
        durationMs: row.duration_ms != null ? Number(row.duration_ms) : null,
        status: row.status as ScheduledTaskRun['status'],
        result: (row.result as string | null) ?? null,
        error: (row.error as string | null) ?? null,
      }),
    );
  }
}
