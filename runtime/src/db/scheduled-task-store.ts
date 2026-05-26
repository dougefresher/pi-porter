import type {
  NewScheduledTaskRun,
  ScheduledTask,
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
    await this.db`
      update scheduled_tasks
      set
        next_run = ${update.nextRun},
        last_run = now(),
        last_result = ${update.lastResult},
        status = ${nextStatus},
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
}
