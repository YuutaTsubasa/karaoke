// Local API for the karaoke app, mounted into the Vite dev / preview server.
//
//   GET    /api/songs                    list songs (library/ + examples/)
//   POST   /api/songs                    create { title, artist } -> song
//   GET    /api/songs/:id                song.json + lyrics text
//   PUT    /api/songs/:id                replace song.json
//   DELETE /api/songs/:id                move the song folder to library/.trash
//   PUT    /api/songs/:id/lyrics         save lyrics text (body = text)
//   PUT    /api/songs/:id/audio?name=x   upload instrumental (body = file)
//   GET    /media/:id/:file              audio with Range support
//   GET    /api/events?role=player|control   server-sent events
//   POST   /api/command  { action, ... }     forwarded to players
//   GET    /api/command?action=toggle        same, for Stream Deck "Website" buttons
//   POST   /api/status   { ... }             player state, forwarded to controls
//
// Everything listens on 127.0.0.1 only (see vite.config.js).

import fs from 'node:fs';
import fsp from 'node:fs/promises';
import path from 'node:path';

const AUDIO_TYPES = {
  '.mp3': 'audio/mpeg',
  '.m4a': 'audio/mp4',
  '.aac': 'audio/aac',
  '.ogg': 'audio/ogg',
  '.opus': 'audio/ogg',
  '.wav': 'audio/wav',
  '.flac': 'audio/flac',
  '.webm': 'audio/webm',
};

export function karaokeApi({ root }) {
  const libraryDir = path.resolve(root, process.env.KARAOKE_LIBRARY || 'library');
  const examplesDir = path.resolve(root, 'examples');
  const clients = new Set(); // { res, role }
  let lastStatus = null;

  fs.mkdirSync(libraryDir, { recursive: true });

  function songDirs() {
    const dirs = [];
    for (const [base, source] of [[examplesDir, 'example'], [libraryDir, 'library']]) {
      if (!fs.existsSync(base)) continue;
      for (const name of fs.readdirSync(base)) {
        if (name.startsWith('.')) continue;
        const dir = path.join(base, name);
        if (fs.existsSync(path.join(dir, 'song.json'))) dirs.push({ id: name, dir, source });
      }
    }
    return dirs;
  }

  function findSong(id) {
    if (!/^[^/\\]+$/.test(id) || id.startsWith('.')) return null;
    return songDirs().find((s) => s.id === id) || null;
  }

  async function readSong(s) {
    const json = JSON.parse(await fsp.readFile(path.join(s.dir, 'song.json'), 'utf8'));
    const lyricsFile = json.lyrics && path.join(s.dir, json.lyrics);
    const audioFile = json.audio && path.join(s.dir, json.audio);
    return {
      ...json,
      id: s.id,
      source: s.source,
      hasLyrics: !!lyricsFile && fs.existsSync(lyricsFile),
      hasAudio: !!audioFile && fs.existsSync(audioFile),
      audioUrl: json.audio ? `/media/${encodeURIComponent(s.id)}/${encodeURIComponent(json.audio)}` : null,
    };
  }

  function broadcast(role, event, data) {
    const payload = `event: ${event}\ndata: ${JSON.stringify(data)}\n\n`;
    for (const c of clients) if (!role || c.role === role) c.res.write(payload);
  }

  function counts() {
    const n = { player: 0, control: 0 };
    for (const c of clients) n[c.role] = (n[c.role] || 0) + 1;
    return n;
  }

  return async function handle(req, res, next) {
    const url = new URL(req.url, 'http://localhost');
    const parts = url.pathname.split('/').filter(Boolean).map(decodeURIComponent);
    try {
      if (parts[0] === 'media' && parts.length === 3) return serveMedia(req, res, parts[1], parts[2]);
      if (parts[0] !== 'api') return next();

      // ---- realtime -------------------------------------------------------
      if (parts[1] === 'events') {
        const role = url.searchParams.get('role') === 'player' ? 'player' : 'control';
        res.writeHead(200, { 'content-type': 'text/event-stream', 'cache-control': 'no-cache', connection: 'keep-alive' });
        res.write(': hello\n\n');
        const client = { res, role };
        clients.add(client);
        if (role === 'control' && lastStatus) res.write(`event: status\ndata: ${JSON.stringify(lastStatus)}\n\n`);
        broadcast('control', 'clients', counts());
        const ping = setInterval(() => res.write(': ping\n\n'), 15000);
        req.on('close', () => {
          clearInterval(ping);
          clients.delete(client);
          broadcast('control', 'clients', counts());
        });
        return;
      }
      if (parts[1] === 'command') {
        let cmd;
        if (req.method === 'GET') cmd = Object.fromEntries(url.searchParams);
        else cmd = JSON.parse((await readBody(req)).toString('utf8') || '{}');
        if (!cmd.action) return send(res, 400, { error: 'action required' });
        broadcast('player', 'command', cmd);
        return send(res, 200, { ok: true, players: counts().player });
      }
      if (parts[1] === 'status' && req.method === 'POST') {
        lastStatus = JSON.parse((await readBody(req)).toString('utf8'));
        broadcast('control', 'status', lastStatus);
        return send(res, 204);
      }
      if (parts[1] === 'clients') return send(res, 200, counts());

      // ---- songs ----------------------------------------------------------
      if (parts[1] !== 'songs') return send(res, 404, { error: 'not found' });

      if (parts.length === 2 && req.method === 'GET') {
        const songs = await Promise.all(songDirs().map(readSong));
        songs.sort((a, b) => (a.source === b.source ? (a.title || a.id).localeCompare(b.title || b.id, 'ja') : a.source === 'example' ? 1 : -1));
        return send(res, 200, songs);
      }
      if (parts.length === 2 && req.method === 'POST') {
        const body = JSON.parse((await readBody(req)).toString('utf8'));
        if (!body.title) return send(res, 400, { error: 'title required' });
        const id = uniqueId(slug(body.title));
        const dir = path.join(libraryDir, id);
        await fsp.mkdir(dir, { recursive: true });
        const json = {
          title: body.title,
          artist: body.artist || '',
          lyricist: body.lyricist || '',
          composer: body.composer || '',
          audio: null,
          lyrics: 'lyrics.lrc',
          offset: 0,
          volume: 1,
          tags: [],
          notes: '',
          performances: [],
          createdAt: new Date().toISOString().slice(0, 10),
        };
        await writeJson(path.join(dir, 'song.json'), json);
        return send(res, 201, await readSong({ id, dir, source: 'library' }));
      }

      const song = findSong(parts[2]);
      if (!song) return send(res, 404, { error: 'no such song' });

      if (parts.length === 3 && req.method === 'GET') {
        const data = await readSong(song);
        const lyricsPath = data.lyrics && path.join(song.dir, data.lyrics);
        data.lyricsText = lyricsPath && fs.existsSync(lyricsPath) ? await fsp.readFile(lyricsPath, 'utf8') : '';
        return send(res, 200, data);
      }
      if (parts.length === 3 && req.method === 'PUT') {
        const body = JSON.parse((await readBody(req)).toString('utf8'));
        for (const k of ['id', 'source', 'hasLyrics', 'hasAudio', 'audioUrl', 'lyricsText']) delete body[k];
        await writeJson(path.join(song.dir, 'song.json'), body);
        return send(res, 200, await readSong(song));
      }
      if (parts.length === 3 && req.method === 'DELETE') {
        if (song.source !== 'library') return send(res, 400, { error: 'examples cannot be deleted' });
        const trash = path.join(libraryDir, '.trash');
        await fsp.mkdir(trash, { recursive: true });
        await fsp.rename(song.dir, path.join(trash, `${song.id}-${Date.now()}`));
        return send(res, 204);
      }
      if (parts[3] === 'lyrics' && req.method === 'PUT') {
        const json = JSON.parse(await fsp.readFile(path.join(song.dir, 'song.json'), 'utf8'));
        const name = safeName(url.searchParams.get('name') || json.lyrics || 'lyrics.lrc');
        const file = path.join(song.dir, name);
        if (fs.existsSync(file)) await fsp.copyFile(file, file + '.bak');
        await fsp.writeFile(file, await readBody(req));
        if (json.lyrics !== name) await writeJson(path.join(song.dir, 'song.json'), { ...json, lyrics: name });
        return send(res, 200, await readSong(song));
      }
      if (parts[3] === 'audio' && req.method === 'PUT') {
        const name = safeName(url.searchParams.get('name') || 'instrumental.mp3');
        if (!AUDIO_TYPES[path.extname(name).toLowerCase()]) return send(res, 400, { error: 'unsupported audio type' });
        const tmp = path.join(song.dir, `.${name}.uploading`);
        await new Promise((resolve, reject) => {
          const out = fs.createWriteStream(tmp);
          req.pipe(out);
          out.on('finish', resolve);
          out.on('error', reject);
          req.on('error', reject);
        });
        await fsp.rename(tmp, path.join(song.dir, name));
        const json = JSON.parse(await fsp.readFile(path.join(song.dir, 'song.json'), 'utf8'));
        await writeJson(path.join(song.dir, 'song.json'), { ...json, audio: name });
        return send(res, 200, await readSong(song));
      }
      return send(res, 405, { error: 'method not allowed' });
    } catch (err) {
      console.error('[karaoke api]', err);
      if (!res.headersSent) send(res, 500, { error: String(err.message || err) });
    }
  };

  function serveMedia(req, res, id, file) {
    const song = findSong(id);
    const name = safeName(file);
    const full = song && path.join(song.dir, name);
    if (!full || !fs.existsSync(full)) return send(res, 404, { error: 'no such file' });
    const size = fs.statSync(full).size;
    const type = AUDIO_TYPES[path.extname(name).toLowerCase()] || 'application/octet-stream';
    const range = /bytes=(\d*)-(\d*)/.exec(req.headers.range || '');
    if (range) {
      const start = range[1] ? Number(range[1]) : size - Number(range[2]);
      const end = range[1] && range[2] ? Math.min(Number(range[2]), size - 1) : size - 1;
      if (start >= size || start > end) {
        res.writeHead(416, { 'content-range': `bytes */${size}` });
        return res.end();
      }
      res.writeHead(206, {
        'content-type': type,
        'content-length': end - start + 1,
        'content-range': `bytes ${start}-${end}/${size}`,
        'accept-ranges': 'bytes',
        'cache-control': 'no-cache',
      });
      return fs.createReadStream(full, { start, end }).pipe(res);
    }
    res.writeHead(200, { 'content-type': type, 'content-length': size, 'accept-ranges': 'bytes', 'cache-control': 'no-cache' });
    fs.createReadStream(full).pipe(res);
  }

  function uniqueId(base) {
    const taken = new Set(songDirs().map((s) => s.id));
    let id = base;
    for (let n = 2; taken.has(id); n++) id = `${base}-${n}`;
    return id;
  }
}

function slug(title) {
  const s = title
    .normalize('NFKC')
    .replace(/[\\/:*?"<>|.\s]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .slice(0, 60);
  return s || `song-${Date.now()}`;
}

function safeName(name) {
  const base = path.basename(String(name));
  if (!base || base.startsWith('.') || /[\\/:*?"<>|]/.test(base)) throw new Error('bad file name');
  return base;
}

function readBody(req) {
  return new Promise((resolve, reject) => {
    const chunks = [];
    req.on('data', (c) => chunks.push(c));
    req.on('end', () => resolve(Buffer.concat(chunks)));
    req.on('error', reject);
  });
}

async function writeJson(file, data) {
  const tmp = file + '.tmp';
  await fsp.writeFile(tmp, JSON.stringify(data, null, 2) + '\n');
  await fsp.rename(tmp, file);
}

function send(res, status, data) {
  if (data === undefined) {
    res.writeHead(status);
    return res.end();
  }
  res.writeHead(status, { 'content-type': 'application/json; charset=utf-8' });
  res.end(JSON.stringify(data));
}
