// `npm run dev`: the Go server (API only) on :5181 and the Vite dev server on :5180,
// which proxies /api and /media to it. OBS and the browser use :5180 as usual.
import { spawn } from 'node:child_process';
import fs from 'node:fs';
import { buildDemo } from './make-demo.js';

buildDemo(); // examples/demo: a test song shown in development only
fs.mkdirSync('dist', { recursive: true });
if (!fs.readdirSync('dist').length) fs.writeFileSync('dist/.keep', ''); // go:embed needs a file there

const procs = [
  spawn('go', ['run', '.', '-serve', '-no-web', '-port', '5181'], { stdio: 'inherit', shell: true }),
  spawn('npx', ['vite'], { stdio: 'inherit', shell: true }),
];
const stop = () => procs.forEach((p) => p.kill());
process.on('SIGINT', stop);
process.on('SIGTERM', stop);
procs.forEach((p) =>
  p.on('exit', (code) => {
    stop();
    process.exit(code ?? 0);
  }),
);
