import type { PorterConfig } from '../config.js';
import type { AgentRunInput, AgentRunner } from './runner.js';
import { SessionWorkerPool } from './worker-pool.js';

export class PiAgentRunner implements AgentRunner {
  private cwd: string;
  private promptTimeoutMs: number;
  private pool: SessionWorkerPool;
  private locks: Map<string, Promise<void>> = new Map();

  constructor(config: PorterConfig) {
    this.cwd = process.cwd();
    this.promptTimeoutMs = config.agentPromptTimeoutMs;

    this.pool = new SessionWorkerPool({
      maxWorkers: config.agentWorkerMaxCount,
      idleTimeoutMs: config.agentWorkerIdleTimeoutMs,
      stateDir: config.stateDir,
    });
  }

  async run(input: AgentRunInput): Promise<string> {
    const key = input.sessionKey;

    // Per-key serialization: chain onto any in-flight run for this key.
    const prevLock = this.locks.get(key) ?? Promise.resolve();
    let release: () => void;
    const thisLock = new Promise<void>((r) => {
      release = r;
    });
    this.locks.set(key, thisLock);

    await prevLock;

    const cwd = input.cwd ?? this.cwd;

    console.log('[agent] run start', {
      sessionKey: key,
      inboundId: input.inboundId,
      inputLength: input.text.length,
      hasInput: input.text.length > 0,
      poolSize: this.pool.size,
    });

    try {
      const result = await this.pool.prompt(key, cwd, input.text, this.promptTimeoutMs);
      console.log('[agent] run done', {
        sessionKey: key,
        inboundId: input.inboundId,
        replyLength: result.length,
        hasReply: result.length > 0,
        poolSize: this.pool.size,
      });
      return result;
    } finally {
      release!();
    }
  }

  shutdown(): void {
    this.pool.shutdown();
  }
}
