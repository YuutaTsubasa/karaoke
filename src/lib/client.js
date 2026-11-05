// Browser-side helpers for the local API.

export const KEY_RANGE = 7; // key change limit, semitones each way

/** ♯2 / ♭3 / 原調 */
export const keyLabel = (k) => (k > 0 ? `♯${k}` : k < 0 ? `♭${-k}` : '原調');

async function json(res) {
  if (!res.ok) {
    let msg = `${res.status} ${res.statusText}`;
    try {
      msg = (await res.json()).error || msg;
    } catch {}
    throw new Error(msg);
  }
  return res.status === 204 ? null : res.json();
}

export const api = {
  songs: () => fetch('/api/songs').then(json),
  song: (id) => fetch(`/api/songs/${encodeURIComponent(id)}`).then(json),
  create: (data) => fetch('/api/songs', { method: 'POST', body: JSON.stringify(data) }).then(json),
  save: (song) => fetch(`/api/songs/${encodeURIComponent(song.id)}`, { method: 'PUT', body: JSON.stringify(song) }).then(json),
  remove: (id) => fetch(`/api/songs/${encodeURIComponent(id)}`, { method: 'DELETE' }).then(json),
  saveLyrics: (id, text, name) =>
    fetch(`/api/songs/${encodeURIComponent(id)}/lyrics${name ? `?name=${encodeURIComponent(name)}` : ''}`, { method: 'PUT', body: text }).then(json),
  uploadAudio: (id, file) =>
    fetch(`/api/songs/${encodeURIComponent(id)}/audio?name=${encodeURIComponent(file.name)}`, { method: 'PUT', body: file }).then(json),
  command: (cmd) => fetch('/api/command', { method: 'POST', body: JSON.stringify(cmd) }).then(json),
  status: (s) => fetch('/api/status', { method: 'POST', body: JSON.stringify(s), keepalive: true }).catch(() => {}),
};

/** Subscribe to server-sent events; handlers keyed by event name. Reconnects by itself. */
export function listen(role, handlers) {
  const es = new EventSource(`/api/events?role=${role}`);
  for (const [name, fn] of Object.entries(handlers)) {
    if (name === 'open' || name === 'error') es.addEventListener(name, fn);
    else es.addEventListener(name, (e) => fn(JSON.parse(e.data)));
  }
  return () => es.close();
}

export function today() {
  const d = new Date();
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
}

export function clock(t) {
  if (!Number.isFinite(t)) return '--:--';
  const s = Math.max(0, Math.floor(t));
  return `${Math.floor(s / 60)}:${String(s % 60).padStart(2, '0')}`;
}
