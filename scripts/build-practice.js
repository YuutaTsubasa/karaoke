// `npm run build:practice [-- <os>/<arch>]`: the read-only practice server alone
// (no window, so it cross-compiles), default for a Mac with Apple silicon.
// Output: build/practice-<os>-<arch>/ with the server and the macOS installer.
import { execFileSync } from 'node:child_process';
import fs from 'node:fs';

const [goos, goarch] = (process.argv[2] || 'darwin/arm64').split('/');
const out = `build/practice-${goos}-${goarch}`;
const exe = goos === 'windows' ? 'karaoke-practice.exe' : 'karaoke-practice';

execFileSync('npx vite build', { stdio: 'inherit', shell: true });
fs.mkdirSync(out, { recursive: true });
execFileSync('go', ['build', '-tags', 'headless', '-trimpath', '-o', `${out}/${exe}`, '.'], {
  stdio: 'inherit',
  env: { ...process.env, GOOS: goos, GOARCH: goarch, CGO_ENABLED: '0' },
});
if (goos === 'darwin') fs.copyFileSync('scripts/practice/install-mac.sh', `${out}/install-mac.sh`);
console.log(`built ${out}/${exe}`);
