import { join } from 'node:path';

export type CronLogEntry = {
  taskId: string;
  taskName?: string | null;
  status: 'success' | 'error';
  durationMs: number;
  prompt?: string;
  result?: string | null;
  error?: unknown;
};

function formatTimestamp(date: Date): string {
  return date.toISOString();
}

function logFilePath(stateDir: string, date = new Date()): string {
  const day = date.toISOString().slice(0, 10).replace(/-/g, '');
  return join(stateDir, 'cron', `${day}.log`);
}

function formatBlock(entry: CronLogEntry): string {
  const lines = [
    `${formatTimestamp(new Date())} task=${entry.taskId} status=${entry.status} duration_ms=${entry.durationMs}`,
  ];
  if (entry.taskName) lines.push(`name: ${entry.taskName}`);
  if (entry.prompt) lines.push(`prompt: ${entry.prompt}`);
  if (entry.result) lines.push(`result: ${entry.result}`);
  if (entry.error) {
    const message = entry.error instanceof Error ? entry.error.stack || entry.error.message : String(entry.error);
    lines.push(`error: ${message}`);
  }
  lines.push('---');
  return `${lines.join('\n')}\n`;
}

async function appendToFile(path: string, chunk: string): Promise<void> {
  const file = Bun.file(path);
  const existing = (await file.exists()) ? await file.text() : '';
  await Bun.write(path, `${existing}${chunk}`, { createPath: true });
}

export async function appendCronLog(stateDir: string, entry: CronLogEntry): Promise<void> {
  const path = logFilePath(stateDir);
  await appendToFile(path, formatBlock(entry));
  console.log(`[scheduler] ${entry.status} task=${entry.taskId} duration_ms=${entry.durationMs}`);
}
