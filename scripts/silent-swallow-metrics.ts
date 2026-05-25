import { existsSync } from 'node:fs';
import path from 'node:path';

export const DEFAULT_REPO_DIRS = ['runtime/src', 'scripts'];
export const DEFAULT_RUNTIME_CORE_DIRS = ['runtime/src'];
export const VALID_EXT = /\.(ts|tsx|js)$/;

type ParserState = 'code' | 'lineComment' | 'blockComment' | 'singleQuote' | 'doubleQuote' | 'template';

export interface SilentSwallowMetrics {
  repoSilentCatchBlocks: number;
  repoFilesWithSilentCatches: number;
  repoSilentPromiseCatches: number;
  runtimeCoreSilentCatches: number;
}

export interface SilentSwallowMatch {
  filePath: string;
  line: number;
  snippet: string;
}

export function shouldSkipPath(filePath: string): boolean {
  return (
    filePath.includes('/vendor/') ||
    filePath.includes('/static/') ||
    filePath.includes('/node_modules/') ||
    filePath.endsWith('.min.js')
  );
}

export async function collectFiles(roots: string[]): Promise<string[]> {
  const files: string[] = [];
  const glob = new Bun.Glob('**/*.{ts,tsx,js}');

  for (const root of roots) {
    if (!existsSync(root)) {
      console.warn(`[check:silent-swallows] skipping missing scan root: ${root}`);
      continue;
    }

    for await (const relativePath of glob.scan({ cwd: root, onlyFiles: true, dot: false })) {
      const filePath = path.join(root, relativePath);
      if (shouldSkipPath(filePath) || !VALID_EXT.test(relativePath)) continue;
      files.push(filePath);
    }
  }

  return files;
}

export function buildNonCodeMask(source: string): Uint8Array {
  const mask = new Uint8Array(source.length);
  let state: ParserState = 'code';
  let escaped = false;
  const templateExprDepth: number[] = [];

  for (let i = 0; i < source.length; i++) {
    const ch = source[i];
    const next = source[i + 1] || '';

    if (state === 'lineComment') {
      mask[i] = 1;
      if (ch === '\n') state = 'code';
      continue;
    }

    if (state === 'blockComment') {
      mask[i] = 1;
      if (ch === '*' && next === '/') {
        mask[i + 1] = 1;
        i++;
        state = 'code';
      }
      continue;
    }

    if (state === 'singleQuote') {
      mask[i] = 1;
      if (escaped) {
        escaped = false;
      } else if (ch === '\\') {
        escaped = true;
      } else if (ch === "'") {
        state = 'code';
      }
      continue;
    }

    if (state === 'doubleQuote') {
      mask[i] = 1;
      if (escaped) {
        escaped = false;
      } else if (ch === '\\') {
        escaped = true;
      } else if (ch === '"') {
        state = 'code';
      }
      continue;
    }

    if (state === 'template') {
      mask[i] = 1;
      if (escaped) {
        escaped = false;
        continue;
      }
      if (ch === '\\') {
        escaped = true;
        continue;
      }
      if (ch === '$' && next === '{') {
        mask[i + 1] = 1;
        i++;
        templateExprDepth.push(1);
        state = 'code';
        continue;
      }
      if (ch === '`') {
        state = 'code';
      }
      continue;
    }

    if (templateExprDepth.length > 0) {
      const lastIndex = templateExprDepth.length - 1;
      const currentDepth = templateExprDepth[lastIndex];
      if (currentDepth === undefined) continue;

      if (ch === '{') {
        templateExprDepth[lastIndex] = currentDepth + 1;
        continue;
      }
      if (ch === '}') {
        const nextDepth = currentDepth - 1;
        if (nextDepth <= 0) {
          templateExprDepth.pop();
          state = 'template';
        } else {
          templateExprDepth[lastIndex] = nextDepth;
        }
        continue;
      }
    }

    if (ch === '/' && next === '/') {
      mask[i] = 1;
      mask[i + 1] = 1;
      i++;
      state = 'lineComment';
      continue;
    }
    if (ch === '/' && next === '*') {
      mask[i] = 1;
      mask[i + 1] = 1;
      i++;
      state = 'blockComment';
      continue;
    }
    if (ch === "'") {
      mask[i] = 1;
      state = 'singleQuote';
      continue;
    }
    if (ch === '"') {
      mask[i] = 1;
      state = 'doubleQuote';
      continue;
    }
    if (ch === '`') {
      mask[i] = 1;
      state = 'template';
    }
  }

  return mask;
}

function isIdentifierChar(ch: string | undefined): boolean {
  return !!ch && /[A-Za-z0-9_$]/.test(ch);
}

function lineOfIndex(source: string, index: number): number {
  let line = 1;
  for (let i = 0; i < index; i++) if (source[i] === '\n') line++;
  return line;
}

function snippetAt(source: string, index: number): string {
  const start = source.lastIndexOf('\n', index) + 1;
  const endIndex = source.indexOf('\n', index);
  const end = endIndex === -1 ? source.length : endIndex;
  return source.slice(start, end).trim();
}

function isWhitespace(ch: string | undefined): boolean {
  return !!ch && /\s/.test(ch);
}

function skipWhitespace(source: string, index: number, mask: Uint8Array): number {
  let cursor = index;
  while (cursor < source.length) {
    const ch = source[cursor];
    if (!mask[cursor] && !isWhitespace(ch)) break;
    cursor++;
  }
  return cursor;
}

function skipBalancedGroup(source: string, index: number, mask: Uint8Array, open: string, close: string): number {
  if (source[index] !== open) return index;
  let depth = 0;
  for (let cursor = index; cursor < source.length; cursor++) {
    if (mask[cursor]) continue;
    if (source[cursor] === open) depth++;
    else if (source[cursor] === close) {
      depth--;
      if (depth === 0) return cursor + 1;
    }
  }
  return source.length;
}

function stripCommentsAndTrim(body: string): string {
  return body
    .replace(/\/\*[\s\S]*?\*\//g, '')
    .replace(/(^|\n)\s*\/\/.*(?=\n|$)/g, '$1')
    .trim();
}

function findSilentCatchBlocksInSource(source: string): Array<{ index: number; line: number; snippet: string }> {
  const matches: Array<{ index: number; line: number; snippet: string }> = [];
  const mask = buildNonCodeMask(source);

  for (let i = 0; i < source.length - 5; i++) {
    if (mask[i]) continue;
    if (source.slice(i, i + 5) !== 'catch') continue;
    if (isIdentifierChar(source[i - 1]) || isIdentifierChar(source[i + 5])) continue;

    let cursor = skipWhitespace(source, i + 5, mask);
    if (source[cursor] === '(') {
      cursor = skipBalancedGroup(source, cursor, mask, '(', ')');
      cursor = skipWhitespace(source, cursor, mask);
    }
    if (source[cursor] !== '{') continue;

    const bodyStart = cursor + 1;
    const closeBraceExclusive = skipBalancedGroup(source, cursor, mask, '{', '}');
    const closeBraceIndex = closeBraceExclusive - 1;
    const body = source.slice(bodyStart, closeBraceIndex);
    if (stripCommentsAndTrim(body) !== '') {
      i = closeBraceIndex;
      continue;
    }

    matches.push({
      index: i,
      line: lineOfIndex(source, i),
      snippet: snippetAt(source, i),
    });
    i = closeBraceIndex;
  }

  return matches;
}

function findSilentPromiseCatchesInSource(source: string): Array<{ index: number; line: number; snippet: string }> {
  const matches: Array<{ index: number; line: number; snippet: string }> = [];
  const mask = buildNonCodeMask(source);

  for (let i = 0; i < source.length - 7; i++) {
    if (mask[i]) continue;
    if (source.slice(i, i + 7) !== '.catch(') continue;

    let cursor = skipWhitespace(source, i + 7, mask);
    if (source[cursor] === '(') {
      cursor = skipBalancedGroup(source, cursor, mask, '(', ')');
      cursor = skipWhitespace(source, cursor, mask);
      if (source.slice(cursor, cursor + 2) !== '=>') continue;
      cursor = skipWhitespace(source, cursor + 2, mask);
    } else if (source.slice(cursor, cursor + 8) === 'function') {
      cursor = skipWhitespace(source, cursor + 8, mask);
      if (source[cursor] === '(') {
        cursor = skipBalancedGroup(source, cursor, mask, '(', ')');
        cursor = skipWhitespace(source, cursor, mask);
      }
    } else {
      continue;
    }

    if (source[cursor] !== '{') continue;
    const bodyStart = cursor + 1;
    const closeBraceExclusive = skipBalancedGroup(source, cursor, mask, '{', '}');
    const closeBraceIndex = closeBraceExclusive - 1;

    const closeParen = skipWhitespace(source, closeBraceIndex + 1, mask);
    if (source[closeParen] !== ')') {
      i = closeBraceIndex;
      continue;
    }

    const body = source.slice(bodyStart, closeBraceIndex);
    if (stripCommentsAndTrim(body) !== '') {
      i = closeParen;
      continue;
    }

    matches.push({
      index: i,
      line: lineOfIndex(source, i),
      snippet: snippetAt(source, i),
    });
    i = closeParen;
  }

  return matches;
}

export async function findSilentCatchBlocks(files: string[]): Promise<SilentSwallowMatch[]> {
  const matches: SilentSwallowMatch[] = [];
  for (const filePath of files) {
    const source = await Bun.file(filePath).text();
    for (const match of findSilentCatchBlocksInSource(source)) {
      matches.push({ filePath, line: match.line, snippet: match.snippet });
    }
  }
  return matches;
}

export async function findSilentPromiseCatches(files: string[]): Promise<SilentSwallowMatch[]> {
  const matches: SilentSwallowMatch[] = [];
  for (const filePath of files) {
    const source = await Bun.file(filePath).text();
    for (const match of findSilentPromiseCatchesInSource(source)) {
      matches.push({ filePath, line: match.line, snippet: match.snippet });
    }
  }
  return matches;
}

function parseEnvRoots(key: string, fallback: string[]): string[] {
  const raw = (process.env[key] || '').trim();
  if (!raw) return fallback;
  return raw
    .split(path.delimiter)
    .map((part) => part.trim())
    .filter(Boolean);
}

export async function getSilentSwallowMetrics(
  options: { repoDirs?: string[]; runtimeCoreDirs?: string[] } = {},
): Promise<SilentSwallowMetrics> {
  const repoDirs = options.repoDirs ?? parseEnvRoots('PORTER_SILENT_SWALLOW_SCAN_ROOTS', DEFAULT_REPO_DIRS);
  const runtimeCoreDirs =
    options.runtimeCoreDirs ?? parseEnvRoots('PORTER_SILENT_SWALLOW_RUNTIME_CORE_ROOTS', DEFAULT_RUNTIME_CORE_DIRS);

  const repoFiles = await collectFiles(repoDirs);
  const runtimeCoreFiles = await collectFiles(runtimeCoreDirs);
  const repoCatch = await findSilentCatchBlocks(repoFiles);
  const repoPromise = await findSilentPromiseCatches(repoFiles);
  const coreCatch = await findSilentCatchBlocks(runtimeCoreFiles);

  return {
    repoSilentCatchBlocks: repoCatch.length,
    repoFilesWithSilentCatches: new Set(repoCatch.map((match) => match.filePath)).size,
    repoSilentPromiseCatches: repoPromise.length,
    runtimeCoreSilentCatches: coreCatch.length,
  };
}

export function printSilentSwallowMetrics(metrics: SilentSwallowMetrics): void {
  console.log(`METRIC repo_silent_catch_blocks=${metrics.repoSilentCatchBlocks}`);
  console.log(`METRIC repo_files_with_silent_catches=${metrics.repoFilesWithSilentCatches}`);
  console.log(`METRIC repo_silent_promise_catches=${metrics.repoSilentPromiseCatches}`);
  console.log(`METRIC runtime_core_silent_catches=${metrics.runtimeCoreSilentCatches}`);
}

export function buildSilentSwallowReport(label: string, matches: SilentSwallowMatch[]): string {
  const lines = [`[check:silent-swallows] ${label} (${matches.length}):`];
  for (const match of matches) {
    lines.push(`- ${match.filePath}:${match.line} — empty or comment-only handler`);
    if (match.snippet) {
      lines.push(`  snippet: ${match.snippet}`);
    }
  }
  return lines.join('\n');
}

export function buildSilentSwallowRemediationHint(): string {
  return [
    '[check:silent-swallows] Remediation: replace empty/comment-only catches with explicit logging or handling.',
    "- Expected fallback / degraded path: console.warn('[component] message', { err: error, ...context })",
    "- Actionable failure / broken invariant: console.error('[component] message', { err: error, ...context })",
    '- Never use .catch(() => {}) on writes/deletes/moves/updates (see AGENTS.md).',
    '- Do not leave catch blocks empty or comment-only.',
  ].join('\n');
}

if (import.meta.main) {
  const checkMode = process.argv.includes('--check');
  const repoDirs = parseEnvRoots('PORTER_SILENT_SWALLOW_SCAN_ROOTS', DEFAULT_REPO_DIRS);
  const runtimeCoreDirs = parseEnvRoots('PORTER_SILENT_SWALLOW_RUNTIME_CORE_ROOTS', DEFAULT_RUNTIME_CORE_DIRS);
  const metrics = await getSilentSwallowMetrics({ repoDirs, runtimeCoreDirs });
  printSilentSwallowMetrics(metrics);

  if (checkMode && (metrics.repoSilentCatchBlocks > 0 || metrics.repoSilentPromiseCatches > 0)) {
    const repoFiles = await collectFiles(repoDirs);
    const catchMatches = await findSilentCatchBlocks(repoFiles);
    const promiseMatches = await findSilentPromiseCatches(repoFiles);
    console.error(
      `[check:silent-swallows] Found ${metrics.repoSilentCatchBlocks} silent catch block(s) and ${metrics.repoSilentPromiseCatches} silent promise catch(es). Comment-only handlers count as silent and must log or handle the error explicitly.`,
    );
    if (catchMatches.length > 0) {
      console.error(buildSilentSwallowReport('Silent catch block sites', catchMatches));
    }
    if (promiseMatches.length > 0) {
      console.error(buildSilentSwallowReport('Silent promise catch sites', promiseMatches));
    }
    console.error(buildSilentSwallowRemediationHint());
    process.exit(1);
  }
}
