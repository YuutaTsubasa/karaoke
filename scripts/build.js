// `npm run build`: the demo audio, the pages (Vite), then the desktop app and its
// installer (mygo build), in build/<os>-<arch>/. Extra arguments go to mygo build,
// e.g. `npm run build -- -platform windows/arm64`.
import { execFileSync } from 'node:child_process';
import { buildDemo } from './make-demo.js';

const run = (cmd, args) => execFileSync([cmd, ...args].join(' '), { stdio: 'inherit', shell: true });

buildDemo();
run('npx', ['vite', 'build']);
run('go', ['tool', 'mygo', 'build', ...process.argv.slice(2)]);
