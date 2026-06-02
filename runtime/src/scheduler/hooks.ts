export type HookResult = {
  exitCode: number;
  stdout: string;
  stderr: string;
};

const HOOK_TIMEOUT_MS = 30_000;

export async function runHook(command: string, workdir?: string | null): Promise<HookResult> {
  const proc = Bun.spawn({
    cmd: ['sh', '-c', command],
    cwd: workdir ?? undefined,
    stdout: 'pipe',
    stderr: 'pipe',
    timeout: HOOK_TIMEOUT_MS,
  });

  const exitCode = await proc.exited;
  const stdout = await new Response(proc.stdout).text();
  const stderr = await new Response(proc.stderr).text();
  return { exitCode, stdout: stdout.trimEnd(), stderr: stderr.trimEnd() };
}
