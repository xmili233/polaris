import { desktopMethods as methods } from '../dist-service/desktop-contract.js';
import { spawn } from 'node:child_process';
import { createInterface } from 'node:readline';

/** One private local process per app; it owns its SQLite connection. */
export class LocalHost {
  #child;
  #pending = new Map();
  #next = 0;
  #closing = false;
  constructor(executable, database, fork, handlers = {}) { this.executable = executable; this.database = database; this.fork = fork; this.handlers = handlers; }

  #start() {
    if (this.#child) return;
    const child = this.fork ? this.fork() : spawn(this.executable, ['--database', this.database], { stdio: ['pipe', 'pipe', 'pipe'] });
    this.#child = child;
    // Diagnostics never include request bodies, credentials, or business data.
    child.stderr?.resume();
    const fail = () => {
      if (this.#child !== child) return;
      this.#child = undefined;
      for (const { reject, timer } of this.#pending.values()) { clearTimeout(timer); reject(new Error('Polaris local service stopped.')); }
      this.#pending.clear();
    };
    child.on('error', fail);
    child.on('exit', fail);
    const receive = response => {
      try {
        if (response.event) { this.handlers.onEvent?.(response.event); return; }
        const pending = this.#pending.get(response.id);
        if (!pending) return;
        clearTimeout(pending.timer);
        this.#pending.delete(response.id);
        if (response.error) pending.reject(Object.assign(new Error(response.error.message), { code: response.error.code, messageKey: response.error.messageKey, params: response.error.params }));
        else pending.resolve(response.result);
      } catch { fail(); child.kill(); }
    };
    if (this.fork) child.on('message', receive);
    else createInterface({ input: child.stdout }).on('line', line => { try { receive(JSON.parse(line)); } catch { fail(); child.kill(); } });
  }

  call(method, params = {}) {
    if (this.#closing) return Promise.reject(new Error('Workspace is closing.'));
    this.#start();
    const id = ++this.#next;
    return new Promise((resolve, reject) => {
      const timer = setTimeout(() => {
        this.#pending.delete(id);
        reject(new Error('Polaris local service timed out. Refresh before retrying a write.'));
        if (method !== 'agentNative' && !method.startsWith('agentOnboarding')) this.stop();
      }, 40_000);
      this.#pending.set(id, { resolve, reject, timer });
      if (this.fork) { this.#child.postMessage({ id, method, params }); return; }
      this.#child.stdin.write(`${JSON.stringify({ id, method, params })}\n`, (error) => {
        if (error) this.stop();
      });
    });
  }

  stop() { this.#child?.kill(); }
  async shutdown() {
    const child = this.#child; if (!child) { this.#closing = true; return; }
    const shutdown = this.call('shutdown'); this.#closing = true;
    try { await Promise.race([shutdown, new Promise(resolve => setTimeout(resolve, 5000))]); } catch { /* The process may already have exited. */ }
    child.kill();
  }
}

export const desktopMethods = new Set(methods);

export function validateCall(method, params) {
  if (!desktopMethods.has(method) || !params || typeof params !== 'object' || Array.isArray(params)
      || Buffer.byteLength(JSON.stringify(params)) > 1_048_576) throw new Error('Invalid desktop request.');
}

export function externalURL(value) {
  try { const url = new URL(value); return ['https:', 'http:', 'mailto:'].includes(url.protocol) ? url.href : null; }
  catch { return null; }
}
