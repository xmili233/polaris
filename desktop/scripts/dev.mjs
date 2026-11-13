import { spawn } from 'node:child_process';
import { createServer } from 'vite';
import electron from 'electron';

const build = spawn('pnpm', ['run', 'build:service'], { stdio: 'inherit' });
await new Promise((resolve, reject) => build.on('exit', code => code === 0 ? resolve() : reject(new Error('Local service build failed.'))));
const server = await createServer();
await server.listen();
const env = { ...process.env, POLARIS_DEV_URL: 'http://127.0.0.1:5173/' };
delete env.ELECTRON_RUN_AS_NODE;
const child = spawn(electron, ['.', ...process.argv.slice(2)], { stdio: 'inherit', env });
child.on('exit', async code => { await server.close(); process.exit(code ?? 0); });
for (const signal of ['SIGINT', 'SIGTERM']) process.on(signal, () => child.kill());
