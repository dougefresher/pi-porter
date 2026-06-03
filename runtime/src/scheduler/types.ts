export type ScheduleType = 'cron' | 'interval' | 'once';

export type TaskStatus = 'active' | 'paused' | 'completed';

export type ScheduledTask = {
  id: string;
  name: string | null;
  prompt: string;
  agentSessionKey: string;
  reportSessionKey: string | null;
  workdir: string | null;
  preHook: string | null;
  postHook: string | null;
  scheduleType: ScheduleType;
  scheduleValue: string;
  nextRun: Date | null;
  lastRun: Date | null;
  lastResult: string | null;
  status: TaskStatus;
  createdAt: Date;
  updatedAt: Date;
};

export type ScheduledTaskRunStatus = 'success' | 'error';

export type NewScheduledTaskRun = {
  taskId: string;
  inboundId?: number | null;
  durationMs: number;
  status: ScheduledTaskRunStatus;
  result?: string | null;
  error?: string | null;
};

export type UpdateScheduledTaskAfterRun = {
  nextRun: Date | null;
  lastResult: string;
  status?: TaskStatus;
};

export type NewScheduledTask = {
  id: string;
  name: string | null;
  prompt: string;
  agentSessionKey: string;
  reportSessionKey: string | null;
  workdir: string | null;
  preHook: string | null;
  postHook: string | null;
  scheduleType: ScheduleType;
  scheduleValue: string;
};

export type ScheduledTaskRun = {
  id: number;
  taskId: string;
  inboundId: number | null;
  runAt: Date;
  durationMs: number | null;
  status: ScheduledTaskRunStatus;
  result: string | null;
  error: string | null;
};
