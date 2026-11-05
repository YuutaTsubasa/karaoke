// Copy the song library to the practice server's machine over SSH, one way: new
// and changed files are sent, files that are gone here are removed there. Hidden
// folders (.trash) and lyric backups (*.bak) stay behind.
//
//   node scripts/practice/sync.mjs <ssh host> [remote library, relative to its home]
//
// The local library is KARAOKE_LIBRARY or ~/Documents/Karaoke. Default remote
// library: Data/20_Assets/Karaoke (what install-mac.sh uses).
import { spawnSync } from 'node:child_process';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

const [host, remoteArg = 'Data/20_Assets/Karaoke'] = process.argv.slice(2);
if (!host) {
  console.error('usage: node scripts/practice/sync.mjs <ssh host> [remote library]');
  process.exit(2);
}
const local = process.env.KARAOKE_LIBRARY || path.join(os.homedir(), 'Documents', 'Karaoke');
const q = (s) => `'${s.replaceAll("'", `'\\''`)}'`;
const remote = remoteArg.startsWith('/') ? q(remoteArg) : `"$HOME"/${q(remoteArg)}`;

function ssh(cmd, input) {
  const r = spawnSync('ssh', ['-o', 'BatchMode=yes', host, cmd], { input, maxBuffer: 1 << 28 });
  if (r.status !== 0) throw new Error(`ssh failed (${r.status}): ${r.stderr?.toString().trim()}`);
  return r.stdout.toString();
}

const skip = (name) => name.startsWith('.') || name.endsWith('.bak');

/** relative path (with /) -> { size, mtime (s) } */
function walk(dir, rel = '', out = new Map()) {
  for (const e of fs.readdirSync(dir, { withFileTypes: true })) {
    if (skip(e.name)) continue;
    const r = rel ? `${rel}/${e.name}` : e.name;
    if (e.isDirectory()) walk(path.join(dir, e.name), r, out);
    else if (e.isFile()) {
      const st = fs.statSync(path.join(dir, e.name));
      out.set(r, { size: st.size, mtime: Math.floor(st.mtimeMs / 1000) });
    }
  }
  return out;
}

const mine = walk(local);
const theirs = new Map();
const listing = ssh(
  `mkdir -p ${remote} && cd ${remote} && find . -type f ! -path './.*' ! -name '*.bak' -exec stat -f '%z %m %N' {} +`,
);
for (const line of listing.split('\n')) {
  const m = /^(\d+) (\d+) \.\/(.+)$/.exec(line);
  if (m) theirs.set(m[3], { size: Number(m[1]), mtime: Number(m[2]) });
}

const send = [...mine].filter(([r, a]) => {
  const b = theirs.get(r);
  return !b || b.size !== a.size || Math.abs(b.mtime - a.mtime) > 1;
});
const gone = [...theirs.keys()].filter((r) => !mine.has(r));

for (const [r, { mtime }] of send) {
  const dst = `${remote}/${q(r)}`;
  const stamp = new Date(mtime * 1000).toISOString().replace(/[-:T]/g, '').slice(0, 12) + '.' + String(new Date(mtime * 1000).getUTCSeconds()).padStart(2, '0');
  ssh(`mkdir -p "$(dirname ${dst})" && cat > ${dst}.part && mv ${dst}.part ${dst} && TZ=UTC touch -t ${stamp} ${dst}`, fs.readFileSync(path.join(local, r)));
  console.log('sent   ', r);
}
if (gone.length) {
  ssh(`cd ${remote} && rm -f -- ${gone.map((r) => q(r)).join(' ')} && find . -mindepth 1 -type d -empty -delete`);
  gone.forEach((r) => console.log('removed', r));
}
console.log(`${send.length} sent, ${gone.length} removed, ${mine.size - send.length} unchanged`);
