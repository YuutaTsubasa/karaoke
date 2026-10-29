// Lyrics model, parser and serializer.
//
// Native format: Enhanced LRC (A2 extension) plus inline ruby markup.
//
//   [ti:Title]
//   [ar:Original artist]
//   [offset:0]
//   [00:12.30]<00:12.30>{青|あお}<00:12.95>い<00:13.20>{風|かぜ}<00:14.00>が<00:14.60>
//
// - `[mm:ss.xx]` starts a line; `<mm:ss.xx>` marks the start of the next syllable
//   (and the end of the previous one). A trailing `<mm:ss.xx>` is the end of the line.
// - A `<mm:ss.xx>` followed directly by another tag is a gap (nothing sung).
// - `{漢字|かんじ}` is group ruby; `{漢字|かん|じ}` is mono ruby (one reading per
//   character), which is split into one syllable per character when timing.
// - A line without `<>` tags is wiped evenly from its start to the next line.
// - An empty `[mm:ss.xx]` line marks the end of the previous line (instrumental break).
//
// Also imported (read only): plain LRC and ASS/SSA with {\k} karaoke tags.

/** @typedef {{ base: string, ruby: string | null }} Part */
/** @typedef {{ parts: Part[], start: number, end: number }} Syllable */
/** @typedef {{ start: number, end: number, syllables: Syllable[], timed: boolean }} Line */
/** @typedef {{ meta: Record<string, string>, offset: number, lines: Line[] }} Lyrics */

const TAG = /\[(\d+):(\d{1,2}(?:[.:]\d{1,3})?)\]/y;
const META = /^\[([a-zA-Z#]+):(.*)\]\s*$/;
const INLINE = /<(\d+):(\d{1,2}(?:[.:]\d{1,3})?)>/g;
const PLAIN_LINE_MAX = 10;

export function parseTime(min, sec) {
  return Number(min) * 60 + Number(String(sec).replace(':', '.'));
}

export function formatTime(t) {
  const cs = Math.max(0, Math.round(t * 100));
  const m = Math.floor(cs / 6000);
  const s = Math.floor((cs % 6000) / 100);
  const c = cs % 100;
  return `${String(m).padStart(2, '0')}:${String(s).padStart(2, '0')}.${String(c).padStart(2, '0')}`;
}

/** Split text with `{base|ruby}` markup into parts. */
export function parseRuby(text) {
  /** @type {Part[]} */
  const parts = [];
  const re = /\{([^{}|]+)\|([^{}]+)\}/g;
  let last = 0;
  for (const m of text.matchAll(re)) {
    if (m.index > last) parts.push({ base: text.slice(last, m.index), ruby: null });
    const readings = m[2].split('|');
    const chars = [...m[1]];
    if (readings.length > 1 && readings.length === chars.length) {
      chars.forEach((c, i) => parts.push({ base: c, ruby: readings[i] }));
    } else {
      parts.push({ base: m[1], ruby: m[2] });
    }
    last = m.index + m[0].length;
  }
  if (last < text.length) parts.push({ base: text.slice(last), ruby: null });
  return parts;
}

export function partsToMarkup(parts) {
  return parts.map((p) => (p.ruby ? `{${p.base}|${p.ruby}}` : p.base)).join('');
}

export function lineText(line) {
  return line.syllables.map((s) => s.parts.map((p) => p.base).join('')).join('');
}

/** @returns {Lyrics} */
export function parseLyrics(text, filename = '') {
  if (/\.(ass|ssa)$/i.test(filename) || /^\s*\[Script Info\]/i.test(text)) return parseAss(text);
  return parseLrc(text);
}

/** @returns {Lyrics} */
export function parseLrc(text) {
  const meta = {};
  const raw = []; // { start, body }
  for (const rawLine of text.replace(/^﻿/, '').split(/\r?\n/)) {
    const line = rawLine.trim();
    if (!line) continue;
    TAG.lastIndex = 0;
    const times = [];
    let m;
    let pos = 0;
    while ((m = TAG.exec(line))) {
      times.push(parseTime(m[1], m[2]));
      pos = TAG.lastIndex;
    }
    if (!times.length) {
      const mm = META.exec(line);
      if (mm) meta[mm[1].toLowerCase()] = mm[2].trim();
      continue;
    }
    const body = line.slice(pos);
    for (const t of times) raw.push({ start: t, body });
  }
  raw.sort((a, b) => a.start - b.start);

  /** @type {Line[]} */
  const lines = [];
  raw.forEach((r, i) => {
    const next = raw[i + 1]?.start;
    if (!r.body.trim()) return; // break marker
    const line = parseLineBody(r.start, r.body, next);
    if (line.syllables.length) lines.push(line);
  });
  const offset = Number(meta.offset || 0) / 1000;
  return { meta, offset, lines };
}

function parseLineBody(start, body, nextStart) {
  const marks = [...body.matchAll(INLINE)];
  /** @type {Syllable[]} */
  const syllables = [];
  if (!marks.length) {
    const end = nextStart != null ? Math.min(nextStart, start + PLAIN_LINE_MAX) : start + 4;
    syllables.push({ parts: parseRuby(body.trim()), start, end });
    return { start, end, syllables, timed: false };
  }
  // text before the first inline tag belongs to the line start
  const lead = body.slice(0, marks[0].index);
  const points = [];
  if (lead.trim()) points.push({ t: start, text: lead });
  marks.forEach((m, i) => {
    const textEnd = marks[i + 1]?.index ?? body.length;
    points.push({ t: parseTime(m[1], m[2]), text: body.slice(m.index + m[0].length, textEnd) });
  });
  points.forEach((p, i) => {
    if (!p.text) return; // pure time mark (end of line / gap)
    let end = points[i + 1]?.t;
    if (end == null) end = nextStart != null ? Math.min(nextStart, p.t + 1.5) : p.t + 1;
    syllables.push({ parts: parseRuby(p.text), start: p.t, end: Math.max(end, p.t) });
  });
  if (!syllables.length) return { start, end: start, syllables, timed: true };
  return { start: syllables[0].start, end: syllables.at(-1).end, syllables, timed: true };
}

/** @returns {Lyrics} */
export function parseAss(text) {
  const meta = {};
  const lines = [];
  let format = null;
  for (const rawLine of text.replace(/^﻿/, '').split(/\r?\n/)) {
    const line = rawLine.trim();
    const t = /^Title:\s*(.*)$/i.exec(line);
    if (t) meta.ti = t[1];
    if (/^Format:/i.test(line) && !format) {
      const f = line.slice(7).split(',').map((s) => s.trim().toLowerCase());
      if (f.includes('text')) format = f;
      continue;
    }
    if (!/^Dialogue:/i.test(line)) continue;
    const fields = format || ['layer', 'start', 'end', 'style', 'name', 'marginl', 'marginr', 'marginv', 'effect', 'text'];
    const values = line.slice(9).split(',');
    const textValue = values.slice(fields.length - 1).join(',');
    const get = (k) => values[fields.indexOf(k)]?.trim();
    const start = assTime(get('start'));
    const end = assTime(get('end'));
    const syllables = [];
    let cursor = start;
    const re = /\{[^}]*?\\[kK][fo]?(\d+)[^}]*\}([^{]*)/g;
    let found = false;
    for (const m of textValue.matchAll(re)) {
      found = true;
      const dur = Number(m[1]) / 100;
      const body = m[2].replace(/\\N/g, ' ');
      if (body) syllables.push({ parts: parseRuby(body), start: cursor, end: cursor + dur });
      cursor += dur;
    }
    if (!found) {
      const body = textValue.replace(/\{[^}]*\}/g, '').replace(/\\N/g, ' ');
      if (body.trim()) syllables.push({ parts: parseRuby(body), start, end });
    }
    if (syllables.length) lines.push({ start: syllables[0].start, end: Math.max(end, syllables.at(-1).end), syllables, timed: found });
  }
  lines.sort((a, b) => a.start - b.start);
  return { meta, offset: 0, lines };
}

function assTime(s) {
  const m = /(\d+):(\d+):(\d+(?:\.\d+)?)/.exec(s || '');
  return m ? Number(m[1]) * 3600 + Number(m[2]) * 60 + Number(m[3]) : 0;
}

/** Serialize to Enhanced LRC. */
export function serializeLrc(lyrics) {
  const out = [];
  for (const [k, v] of Object.entries(lyrics.meta || {})) {
    if (k === 'offset') continue;
    out.push(`[${k}:${v}]`);
  }
  if (lyrics.offset) out.push(`[offset:${Math.round(lyrics.offset * 1000)}]`);
  const lines = lyrics.lines;
  lines.forEach((line, i) => {
    let body = '';
    let cursor = null;
    for (const s of line.syllables) {
      if (cursor != null && s.start - cursor > 0.005) body += `<${formatTime(cursor)}>`;
      body += `<${formatTime(s.start)}>${partsToMarkup(s.parts)}`;
      cursor = s.end;
    }
    body += `<${formatTime(line.end)}>`;
    out.push(`[${formatTime(line.start)}]${line.timed ? body : partsToMarkup(line.syllables.flatMap((s) => s.parts))}`);
    const next = lines[i + 1];
    if (line.timed && next && next.start - line.end > 3) out.push(`[${formatTime(line.end)}]`);
  });
  return out.join('\n') + '\n';
}

// ---------------------------------------------------------------------------
// Splitting plain lyrics text into tappable syllables (timing tool).

const SMALL = /^[ぁぃぅぇぉゃゅょゎっァィゥェォャュョヮッヵヶー～〜、。，．！？!?,.・…」』）)\]】〕〉》"'’”\s]$/u;
const LATIN = /[\p{Script=Latin}\p{N}'’]/u;

/** Split one line of markup into syllable parts. */
export function splitSyllables(markup) {
  /** @type {Part[][]} */
  const units = [];
  for (const part of parseRuby(markup)) {
    if (part.ruby) {
      units.push([part]);
      continue;
    }
    const chars = [...part.base];
    for (let i = 0; i < chars.length; i++) {
      const c = chars[i];
      const prev = units.at(-1);
      const prevPart = prev?.at(-1);
      if (LATIN.test(c)) {
        // Latin words stay together
        if (prevPart && !prevPart.ruby && LATIN.test(prevPart.base.at(-1))) {
          prevPart.base += c;
          continue;
        }
        units.push([{ base: c, ruby: null }]);
        continue;
      }
      if (SMALL.test(c) && prev) {
        if (prevPart.ruby) prev.push({ base: c, ruby: null });
        else prevPart.base += c;
        continue;
      }
      if (/^[「『（(【〔〈《"“‘]$/u.test(c)) {
        // opening brackets attach to the next syllable
        units.push([{ base: c, ruby: null }]);
        units.at(-1).open = true;
        continue;
      }
      if (prev?.open && !prevPart.ruby) {
        prevPart.base += c;
        delete prev.open;
        continue;
      }
      units.push([{ base: c, ruby: null }]);
    }
  }
  // drop whitespace-only units at the start
  while (units.length && !units[0].some((p) => p.ruby || p.base.trim())) units.shift();
  return units.map((u) => u.map(({ base, ruby }) => ({ base, ruby })));
}

/** Build an untimed lyrics skeleton from plain text (one lyric line per text line). */
export function skeletonFromText(text) {
  return text
    .split(/\r?\n/)
    .map((l) => l.trim())
    .filter(Boolean)
    .map((l) => ({ start: 0, end: 0, timed: true, syllables: splitSyllables(l).map((parts) => ({ parts, start: 0, end: 0 })) }));
}

/** Recover the editable markup text of a parsed lyrics file. */
export function lyricsToText(lyrics) {
  return lyrics.lines.map((l) => l.syllables.map((s) => partsToMarkup(s.parts)).join('')).join('\n');
}

/** Progress 0..1 of a syllable at time t. */
export function syllableProgress(s, t) {
  if (t <= s.start) return 0;
  if (t >= s.end) return 1;
  return (t - s.start) / (s.end - s.start || 1);
}
