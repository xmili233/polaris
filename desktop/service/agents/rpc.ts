import { spawn, type ChildProcessWithoutNullStreams } from 'node:child_process';
import { PolarisError } from '../model.js';

// The child owns its authentication. Never silently inherit API billing credentials.
export function nativeEnvironment(extra: Record<string, string> = {}) {
  const env = { ...process.env };
  for (const key of Object.keys(env)) if (/^(OPENAI_API_KEY|OPENAI_BASE_URL|ANTHROPIC_API_KEY|ANTHROPIC_AUTH_TOKEN|ANTHROPIC_BASE_URL|CLAUDE_CODE_OAUTH_TOKEN|CLAUDE_CODE_USE_|GEMINI_API_KEY|GOOGLE_API_KEY|GOOGLE_GENAI_USE_|GOOGLE_APPLICATION_CREDENTIALS|ACCESS_TOKEN|NODE_OPTIONS|NODE_DEBUG|POLARIS_)/.test(key)) delete env[key];
  return { ...env, ...extra };
}
export class NativeRPC {
  readonly child: ChildProcessWithoutNullStreams;
  private seq = 0; private buffer = ''; private exited = false;
  private exitError?: Error;
  private pending = new Map<number, { resolve(v: any): void; reject(e: Error): void; timer?: ReturnType<typeof setTimeout> }>();
  onNotification: (method: string, params: any) => void = () => {};
  onRequest: (method: string, params: any, id?: string | number) => Promise<any> = async () => { throw new Error('Unsupported client method.'); };
  onExit: () => void = () => {};
  get alive() { return !this.exited && !this.child.killed; }
  constructor(command: string, args: string[], options: { cwd?: string; env?: NodeJS.ProcessEnv; authenticationPrompt?: RegExp } = {}) {
    const { authenticationPrompt, ...spawnOptions } = options;
    this.child = spawn(command, args, { ...spawnOptions, stdio: 'pipe', windowsHide: true });
    this.child.stdout.setEncoding('utf8');
    this.child.stdout.on('data', chunk => {
      this.buffer += chunk;
      if (authenticationPrompt?.test(this.buffer)) {
        this.exitError = new PolarisError('native_auth', 'Sign in using the native Agent terminal.');
        void this.close(); return;
      }
      if (Buffer.byteLength(this.buffer) > 4 * 1024 * 1024) { void this.close(); return; }
      let index;
      while ((index = this.buffer.indexOf('\n')) >= 0) {
        const line = this.buffer.slice(0, index); this.buffer = this.buffer.slice(index + 1);
        if (!line.trim()) continue;
        try { this.receive(JSON.parse(line)); } catch { /* Non-protocol diagnostics cannot become events. */ }
      }
    });
    this.child.stdin.on('error', () => {});
    this.child.stderr.resume(); // Native diagnostics can contain account data; never persist them wholesale.
    const exit = () => {
      if (this.exited) return; this.exited = true;
      for (const item of this.pending.values()) { clearTimeout(item.timer); item.reject(this.exitError ?? new PolarisError('native_disconnected', 'The native Agent process exited.')); }
      this.pending.clear(); this.onExit();
    };
    this.child.on('error', exit); this.child.on('exit', exit);
  }
  private receive(message: any) {
    if (!message || typeof message !== 'object') return;
    if (typeof message.method === 'string') {
      if (message.id !== undefined) void this.onRequest(message.method, message.params ?? {}, message.id).then(
        result => this.write({ jsonrpc: '2.0', id: message.id, result }),
        () => this.write({ jsonrpc: '2.0', id: message.id, error: { code: -32603, message: 'Client request was not approved or supported.' } }),
      );
      else this.onNotification(message.method, message.params ?? {});
    } else {
      const item = this.pending.get(message.id); if (!item) return;
      this.pending.delete(message.id); clearTimeout(item.timer);
      if (message.error) item.reject(Object.assign(new PolarisError(message.error.code === -32000 ? 'native_auth' : 'native_protocol', String(message.error.message ?? 'Native request failed.').slice(0, 500)), { rpcCode: message.error.code }));
      else item.resolve(message.result);
    }
  }
  private write(message: unknown) { if (!this.exited) this.child.stdin.write(JSON.stringify(message) + '\n'); }
  request(method: string, params: unknown = {}, timeout = 30_000): Promise<any> {
    if (this.exited) return Promise.reject(new PolarisError('native_disconnected', 'Native process is closed.'));
    const id = ++this.seq;
    return new Promise((resolve, reject) => {
      const timer = timeout ? setTimeout(() => { this.pending.delete(id); reject(new PolarisError('native_timeout', `Native ${method} timed out.`)); }, timeout) : undefined;
      this.pending.set(id, { resolve, reject, timer }); this.write({ jsonrpc: '2.0', id, method, params });
    });
  }
  notify(method: string, params: unknown = {}) { this.write({ jsonrpc: '2.0', method, params }); }
  closeOnAbort(signal?: AbortSignal) {
    const abort = () => { void this.close(); };
    signal?.addEventListener('abort', abort, { once: true });
    if (signal?.aborted) abort();
    return () => signal?.removeEventListener('abort', abort);
  }
  async close() {
    if (this.exited) return;
    const ended = new Promise<void>(resolve => this.child.once('exit', () => resolve()));
    this.child.stdin.end(); this.child.kill('SIGTERM');
    const timer = setTimeout(() => this.child.kill('SIGKILL'), 1500); timer.unref();
    await ended; clearTimeout(timer);
  }
}
