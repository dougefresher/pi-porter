#!/usr/bin/env bun

/**
 * Porter entry point. Everything routes through cmd-ts.
 *
 *   porter serve         Start the daemon
 *   porter agent-worker  Internal: worker child process (spawned by daemon)
 *   porter status        Daemon health
 *   porter workers       Worker pool snapshot
 *   porter task ...      Scheduled task management
 */

import { runCli } from './cli.js';

await runCli(Bun.argv);
