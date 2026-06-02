/**
 * LRU pool of long-lived Pi agent worker processes.
 *
 * Each worker is a Bun child process running `porter --agent-worker`.
 * In production this is the compiled binary; in development it's
 * `bun <entrypoint> --agent-worker`.
 *
 * The pool keeps at most `maxWorkers` processes alive, evicting
 * the least recently used on overflow. Idle workers are expired
 * after `idleTimeoutMs` via QuickLRU's maxAge.
 */

import { join } from 'node:path';
import QuickLRU from 'quick-lru';
import { sessionDirForKey } from './session-paths.js';

// ---- Spawn helpers ----

/**
 * Build the spawn command for a worker child process.
 *
 * Compiled binary (Bun.main === process.execPath):
 *   ["/usr/bin/porter", "--agent-worker"]
 *
 * Development (bun run):
 *   ["/usr/bin/bun", "<absolute-path>/runtime/src/index.ts", "--agent-worker"]
 */
function workerSpawnCommand(): string[] {
  if (Bun.main === process.execPath) {
    return [process.execPath, '--agent-worker'];
  }
  return [process.execPath, Bun.main, '--agent-worker'];
}

// ---- Types ----

interface WorkerEntry {
  proc: Bun.Subprocess;
  state: 'booting' | 'ready' | 'busy';
  readyPromise: Promise<void>;
}

interface PendingPrompt {
  resolve: (result: string) => void;
  reject: (error: Error) => void;
  chunks: string[];
  timeout: ReturnType<typeof setTimeout>;
}

export interface WorkerPoolOptions {
  /** Maximum number of concurrent worker processes (LRU eviction boundary). */
  maxWorkers: number;
  /** Milliseconds of inactivity before an idle worker is SIGTERM'd. */
  idleTimeoutMs: number;
  /** Porter state directory root (session data lives under <stateDir>/pi-sessions). */
  stateDir: string;
}

// ---- Pool ----

export class SessionWorkerPool {
  private workers: QuickLRU<string, WorkerEntry>;
  private pending: Map<string, PendingPrompt> = new Map();
  private workerCmd: string[];
  private sessionRoot: string;

  constructor(options: WorkerPoolOptions) {
    this.workerCmd = workerSpawnCommand();
    this.sessionRoot = join(options.stateDir, 'pi-sessions');

    this.workers = new QuickLRU<string, WorkerEntry>({
      maxSize: options.maxWorkers,
      maxAge: options.idleTimeoutMs,
      onEviction: (key, entry) => {
        if (entry.state === 'busy') {
          console.warn('[worker-pool] refusing to evict busy worker', { sessionKey: key });
          return;
        }
        console.log('[worker-pool] evicting idle worker', { sessionKey: key });
        entry.proc.kill('SIGTERM');
      },
    });
  }

  // ---- Public API ----

  /**
   * Send a prompt to the worker for `key`, spawning one if needed.
   *
   * The returned promise resolves with the final assistant text
   * or rejects if the prompt times out, the worker crashes, or
   * the agent returns an error.
   */
  async prompt(key: string, cwd: string, text: string, timeoutMs: number): Promise<string> {
    const entry = await this.#getOrSpawn(key, cwd);
    entry.state = 'busy';

    return new Promise<string>((resolve, reject) => {
      const timeout = setTimeout(() => {
        this.pending.delete(key);
        entry.proc.kill('SIGTERM');
        this.workers.delete(key);
        reject(new Error(`Agent prompt timed out after ${timeoutMs}ms`));
      }, timeoutMs);

      this.pending.set(key, { resolve, reject, chunks: [], timeout });
      entry.proc.send({ type: 'prompt', text });
    });
  }

  /** SIGTERM all workers. Call during daemon shutdown. */
  shutdown(): void {
    for (const [, entry] of this.workers) {
      entry.proc.kill('SIGTERM');
    }
    // Reject any in-flight prompts so callers don't hang.
    for (const [, pending] of this.pending) {
      clearTimeout(pending.timeout);
      pending.reject(new Error('Worker pool shutting down'));
    }
    this.pending.clear();
    this.workers.clear();
  }

  /** Current number of live workers. */
  get size(): number {
    return this.workers.size;
  }

  // ---- Internal ----

  #spawn(key: string, cwd: string): WorkerEntry {
    let resolveReady: () => void;
    let rejectReady: (error: Error) => void;
    const readyPromise = new Promise<void>((resolve, reject) => {
      resolveReady = resolve;
      rejectReady = reject;
    });

    const entry: WorkerEntry = {
      proc: null as unknown as Bun.Subprocess, // assigned below
      state: 'booting',
      readyPromise,
    };

    const sessionDir = sessionDirForKey(this.sessionRoot, key);

    const proc = Bun.spawn([...this.workerCmd], {
      cwd: process.cwd(),
      stdio: ['inherit', 'inherit', 'inherit'],
      ipc: (message: any, _childProc: Bun.Subprocess) => {
        switch (message?.type) {
          case 'ready':
            entry.state = 'ready';
            resolveReady();
            break;
          case 'delta': {
            const pending = this.pending.get(key);
            if (pending && typeof message.text === 'string') {
              pending.chunks.push(message.text);
            }
            break;
          }
          case 'done': {
            const pending = this.pending.get(key);
            if (pending) {
              clearTimeout(pending.timeout);
              this.pending.delete(key);
              entry.state = 'ready';
              const result = typeof message.result === 'string' ? message.result : '(no response)';
              pending.resolve(result);
            }
            break;
          }
          case 'error': {
            // Boot-time error
            if (entry.state === 'booting') {
              rejectReady(new Error(typeof message.message === 'string' ? message.message : 'Unknown init error'));
              this.workers.delete(key);
              return;
            }
            // Prompt-time error
            const pending = this.pending.get(key);
            if (pending) {
              clearTimeout(pending.timeout);
              this.pending.delete(key);
              entry.state = 'ready';
              pending.reject(new Error(typeof message.message === 'string' ? message.message : 'Unknown agent error'));
            }
            break;
          }
        }
      },
      onExit: (_proc, exitCode, signalCode, error) => {
        console.log('[worker-pool] worker exited', {
          sessionKey: key,
          exitCode,
          signalCode,
          error: error?.message,
        });

        // Reject in-flight prompt if worker crashed mid-run.
        const pending = this.pending.get(key);
        if (pending) {
          clearTimeout(pending.timeout);
          this.pending.delete(key);
          pending.reject(new Error(`Agent worker exited unexpectedly (exit=${exitCode}, signal=${signalCode})`));
        }

        this.workers.delete(key);
      },
    });

    entry.proc = proc;
    proc.send({ type: 'init', sessionKey: key, cwd, sessionDir });

    return entry;
  }

  /** Evict one idle worker to make room before inserting a new entry. */
  #makeRoom(): void {
    if (this.workers.size < this.workers.maxSize) return;

    for (const [key, entry] of this.workers.entriesDescending()) {
      if (entry.state !== 'busy') {
        console.log('[worker-pool] making room, evicting idle worker', { sessionKey: key });
        entry.proc.kill('SIGTERM');
        // QuickLRU.delete() does not fire onEviction, so we kill explicitly.
        this.workers.delete(key);
        return;
      }
    }
    // All workers are busy — insertion will temporarily exceed maxSize.
    // QuickLRU tolerates up to 2x maxSize before automatic eviction,
    // and onEviction is guarded against busy workers.
  }

  async #getOrSpawn(key: string, cwd: string): Promise<WorkerEntry> {
    const existing = this.workers.get(key);
    if (existing) return existing;

    const entry = this.#spawn(key, cwd);
    this.#makeRoom();
    this.workers.set(key, entry);

    try {
      await entry.readyPromise;
      return entry;
    } catch (error) {
      this.workers.delete(key);
      throw error;
    }
  }
}
