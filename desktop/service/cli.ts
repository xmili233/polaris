import { KnowledgeStore } from './knowledge.js';
import { randomUUID } from 'node:crypto';
import { readFileSync, realpathSync } from 'node:fs';
import { pathToFileURL } from 'node:url';
import path from 'node:path';
import { PolarisStore, defaultDatabase } from './store.js';
import { activeDatabase } from './workspaces.js';
import { type Kind, PolarisError, encode, kinds } from './model.js';

export const help = `Polaris CLI
polaris [--database PATH] status
polaris [--database PATH] context [--goal ID]
polaris [--database PATH] goal|strategy|decision list
polaris [--database PATH] outcomes [--unacknowledged]
polaris [--database PATH] history goal|policy|strategy|decision ID
polaris [--database PATH] knowledge list [--goal ID] [--query TEXT] [--offset N]
polaris [--database PATH] knowledge get|history|export ID
polaris [--database PATH] knowledge save --input FILE|-
polaris [--database PATH] knowledge import --input FILE|- [--goal ID]
polaris [--database PATH] knowledge rules

Use the built-in Polaris Agent for goals, strategies, decisions and execution. See docs/cli.md in the Polaris repository for field schemas.`;
const usage = (message = help): never => { throw new PolarisError('usage', message); };
function readInput(source: string) {
  const raw = readFileSync(source === '-' ? 0 : source);
  if (raw.byteLength > 1_048_576) throw new PolarisError('invalid_input', 'JSON input must be at most 1 MiB.');
  return raw;
}
function parseInput(raw: Buffer) {
  try { return JSON.parse(raw.toString('utf8')); }
  catch { throw new PolarisError('invalid_input', 'Invalid JSON input or field type.'); }
}
export function execute(arguments_: string[]) {
  const args = [...arguments_]; let database = defaultDatabase;
  if (args[0] === '--database') {
    if (args.length < 3 || !args[1]) usage('--database requires a path followed by a command.');
    database = path.resolve(args[1]); args.splice(0, 2);
  } else database = activeDatabase(defaultDatabase);
  const command = args[0]; if (!command) usage();
  const store = new PolarisStore(database);
  try {
    if (command === 'status' && args.length === 1) return { schemaVersion: store.query('PRAGMA user_version')[0].user_version, database: store.file,
      pending: store.snapshot().decisions.filter(decision => !decision.outcome).length, unacknowledged: store.outcomes(true).length };
    if (command === 'context' && (args.length === 1 || (args.length === 3 && args[1] === '--goal'))) return { ...store.context(args[2]), knowledge: new KnowledgeStore(store).context(args[2]) };
    if (command === 'knowledge') {
      const library = new KnowledgeStore(store), action = args[1];
      if (args.length === 2 && action === 'rules') return library.rules();
      if (args.length === 3 && action === 'get') return library.read(args[2]);
      if (args.length === 3 && action === 'history') return library.history(args[2]);
      if (args.length === 3 && action === 'export') return library.exportMarkdown(args[2]).markdown;
      if (action === 'save' && args.length === 4 && args[2] === '--input') {
        const input = parseInput(readInput(args[3]));
        return library.save(input, { jobID: 'cli', rulesVersion: input?.rulesVersion });
      }
      if (action === 'import' && (args.length === 4 || (args.length === 6 && args[4] === '--goal')) && args[2] === '--input') {
        let markdown;
        try { markdown = new TextDecoder('utf-8', { fatal: true }).decode(readInput(args[3])); } catch { throw new PolarisError('invalid_input', 'Invalid UTF-8 Markdown.'); }
        return library.importMarkdown({ markdown, filename: args[3] === '-' ? 'import.md' : path.basename(args[3]), goalID: args[5], requestID: randomUUID() });
      }
      if (action === 'list' && args.length % 2 === 0) {
        const input: Record<string, unknown> = {};
        for (let i = 2; i < args.length; i += 2) {
          const key = ({ '--goal': 'goalID', '--query': 'query', '--offset': 'offset' } as Record<string, string>)[args[i]];
          if (!key || key in input) usage(); input[key] = key === 'offset' ? Number(args[i + 1]) : args[i + 1];
        }
        return library.list(input);
      }
      return usage();
    }
    if (kinds.includes(command as Kind) && args.length === 2 && args[1] === 'list') {
      const board = store.snapshot(); return board[({ goal: 'goals', strategy: 'strategies', decision: 'decisions' } as const)[command as Kind]];
    }
    if (command === 'outcomes' && (args.length === 1 || (args.length === 2 && args[1] === '--unacknowledged'))) return store.outcomes(args.length === 2);
    if (command === 'history' && args.length === 3 && (kinds.includes(args[1] as Kind) || args[1] === 'policy'))
      return store.query('SELECT payload FROM revision WHERE kind=? AND entity_id=? ORDER BY version', args[1], args[2]).map(row => JSON.parse(String(row.payload)));
    return usage();
  } finally { store.close(); }
}
export function runCLI(args = process.argv.slice(2)) {
  if (!args.length || (args.length === 1 && ['--help', 'help'].includes(args[0]))) { process.stdout.write(`${help}\n`); return 0; }
  try { const result = execute(args); process.stdout.write(typeof result === 'string' ? result : `${encode(result)}\n`); return 0; }
  catch (error) {
    const failure = error instanceof PolarisError ? error : new PolarisError('storage', (error as Error).message);
    process.stderr.write(`${encode({ code: failure.code, message: failure.message })}\n`);
    return ({ usage: 2, invalid_input: 2, not_found: 3, conflict: 4, empty: 4 } as Record<string, number>)[failure.code] ?? 1;
  }
}
if (process.argv[1] && import.meta.url === pathToFileURL(realpathSync(process.argv[1])).href) process.exitCode = runCLI();
