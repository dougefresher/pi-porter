import type { ScheduleType } from './types.js';

export type ComputeNextRunOptions = {
  currentDate?: Date | number | null;
};

export function computeNextRun(
  scheduleType: ScheduleType,
  scheduleValue: string,
  options: ComputeNextRunOptions = {},
): Date | null {
  if (scheduleType === 'cron') {
    try {
      const relativeDate = options.currentDate ?? Date.now();
      return Bun.cron.parse(scheduleValue, relativeDate);
    } catch {
      return null;
    }
  }

  if (scheduleType === 'interval') {
    if (!/^\d+$/.test(scheduleValue.trim())) return null;
    const ms = Number(scheduleValue);
    if (!Number.isFinite(ms) || ms <= 0) return null;
    return new Date(Date.now() + ms);
  }

  if (scheduleType === 'once') {
    return null;
  }

  return null;
}

export function computeInitialNextRun(scheduleType: ScheduleType, scheduleValue: string): Date | null {
  if (scheduleType === 'once') {
    const at = new Date(scheduleValue);
    return Number.isNaN(at.getTime()) ? null : at;
  }
  return computeNextRun(scheduleType, scheduleValue);
}
