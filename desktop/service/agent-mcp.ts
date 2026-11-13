import { createServer } from 'node:http';
import { createInterface } from 'node:readline';
import { randomBytes } from 'node:crypto';
import { z } from 'zod';
import type { ActionDefinition } from './agent-actions.js';
import { PolarisError } from './model.js';

export async function createBusinessMCP(actions: ActionDefinition[], assertActive: () => void, afterCall: (name: string) => void) {
  const token = randomBytes(32).toString('hex');
  const handle = async (message: any) => {
    const result = (value: unknown) => ({ jsonrpc: '2.0', id: message.id, result: value });
    if (message.method === 'initialize') return result({ protocolVersion: '2024-11-05', capabilities: { tools: {} }, serverInfo: { name: 'polaris-business', version: '1' } });
    if (message.method?.startsWith('notifications/')) return null;
    if (message.method === 'ping') return result({});
    if (message.method === 'tools/list') return result({ tools: actions.map(action => ({ name: action.name, description: action.description, inputSchema: z.toJSONSchema(action.parameters, { target: 'draft-7' }) })) });
    if (message.method === 'tools/call') {
      try {
        assertActive();
        const action = actions.find(item => item.name === message.params?.name);
        if (!action) throw new PolarisError('invalid_input', 'Unknown Polaris tool.');
        const value = await action.execute(message.params.arguments ?? {});
        afterCall(action.name);
        return result({ content: [{ type: 'text', text: typeof value === 'string' ? value : JSON.stringify(value) }] });
      } catch (error) {
        return result({ isError: true, content: [{ type: 'text', text: JSON.stringify({ code: error instanceof PolarisError ? error.code : 'invalid_input', message: error instanceof PolarisError ? error.message : 'Invalid Polaris tool arguments.' }) }] });
      }
    }
    return { jsonrpc: '2.0', id: message.id, error: { code: -32601, message: 'Method not found.' } };
  };
  const server = createServer(async (req, res) => {
    if (req.method !== 'POST' || req.url !== '/mcp' || req.headers.authorization !== `Bearer ${token}`) { res.writeHead(403); res.end(); return; }
    let body = ''; try {
      for await (const chunk of req) { body += chunk; if (Buffer.byteLength(body) > 1_048_576) throw new Error('Too large'); }
      const reply = await handle(JSON.parse(body)); res.setHeader('content-type', 'application/json'); res.end(JSON.stringify(reply));
    } catch { res.writeHead(400); res.end(); }
  });
  await new Promise<void>((resolve, reject) => { server.once('error', reject); server.listen(0, '127.0.0.1', () => resolve()); });
  const address = server.address(); if (!address || typeof address === 'string') throw new Error('Missing MCP address');
  return { endpoint: `http://127.0.0.1:${address.port}/mcp`, token, close: () => new Promise<void>(resolve => { server.closeAllConnections(); server.close(() => resolve()); }) };
}

// A stdio child only forwards scoped requests; it never opens the database.
if (process.argv.includes('--stdio-proxy')) {
  const endpoint = process.env.POLARIS_MCP_ENDPOINT ?? '', token = process.env.POLARIS_MCP_TOKEN ?? '';
  if (!/^http:\/\/127\.0\.0\.1:\d+\/mcp$/.test(endpoint) || !/^[a-f0-9]{64}$/.test(token)) process.exit(1);
  const lines = createInterface({ input: process.stdin });
  lines.on('line', line => { void (async () => {
    let input: any;
    try {
      input = JSON.parse(line); const response = await fetch(endpoint, { method: 'POST', headers: { authorization: `Bearer ${token}`, 'content-type': 'application/json' }, body: line });
      if (!response.ok) throw new Error('Inactive scope'); const value = await response.json();
      if (value) process.stdout.write(JSON.stringify(value) + '\n');
    } catch { if (input?.id !== undefined) process.stdout.write(JSON.stringify({ jsonrpc: '2.0', id: input.id, error: { code: -32603, message: 'Polaris scope is no longer active.' } }) + '\n'); }
  })(); });
}
