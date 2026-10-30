// JOYSOUND-style two-row layout: line i goes to row i % 2 (top row left-aligned,
// bottom row right-aligned). A line appears when its row is free (shortly after the
// line two before it is finished) but no earlier than `preroll` before it starts,
// and disappears when the next line for its row needs the space.

export const DEFAULTS = {
  preroll: 3.2, // longest a line is shown before it is sung
  after: 0.25, // a finished line stays this long before the next one replaces it
  linger: 1.6, // longest a finished line stays when nothing replaces it
  countdownGap: 4.5, // a silence this long before a line gets countdown dots
  countdown: 2.4, // how long the countdown dots run
};

/**
 * @param {import('./lyrics.js').Line[]} lines
 * @returns {{ row: number, show: number, hide: number, countdown: number | null }[]}
 */
export function schedule(lines, opts = {}) {
  const o = { ...DEFAULTS, ...opts };
  const out = lines.map((line, i) => {
    const prevSameRow = lines[i - 2];
    let show = line.start - o.preroll;
    if (prevSameRow) show = Math.max(show, prevSameRow.end + o.after);
    show = Math.min(show, line.start - 0.15);
    const prev = lines[i - 1];
    const gap = prev ? line.start - prev.end : line.start;
    const countdown = gap >= o.countdownGap ? line.start - o.countdown : null;
    return { row: i % 2, show, hide: Infinity, countdown };
  });
  out.forEach((s, i) => {
    const line = lines[i];
    const next = out[i + 2];
    s.hide = Math.min(next ? next.show : Infinity, line.end + o.linger);
  });
  // After a break the first line goes to the top row again.
  let shift = 0;
  out.forEach((s, i) => {
    if (i > 0 && s.countdown != null && (i + shift) % 2 === 1) shift ^= 1;
    s.row = (i + shift) % 2;
  });
  // re-check row conflicts caused by the shift: a line may only show after the
  // previous line in the same row has gone
  for (let i = 0; i < out.length; i++) {
    for (let j = i - 1; j >= 0 && j >= i - 3; j--) {
      if (out[j].row === out[i].row && out[j].hide > out[i].show) {
        out[j].hide = Math.max(lines[j].end + 0.05, out[i].show);
        out[i].show = Math.max(out[i].show, out[j].hide);
      }
    }
  }
  return out;
}

// ---------------------------------------------------------------------------
// Long lines: real karaoke screens break a line that does not fit into two rows
// rather than shrinking it. Split at a phrase break (space, punctuation, or a
// pause in the singing) as close to the middle as possible.

const HALF = /[\x20-\x7e｡-ﾟ]/;
const PUNCT = /[、。，．,.！？!?…」』）)]\s*$/u;

function partWidth(p) {
  const w = (s) => [...s].reduce((n, c) => n + (HALF.test(c) ? 0.55 : 1), 0);
  return Math.max(w(p.base), p.ruby ? w(p.ruby) * 0.46 : 0);
}

/** Width of a syllable in em. */
export function syllableWidth(s) {
  return s.parts.reduce((n, p) => n + partWidth(p), 0);
}

function trimEnd(s) {
  const parts = s.parts.map((p) => ({ ...p }));
  const last = parts.at(-1);
  if (!last.ruby) last.base = last.base.replace(/\s+$/u, '');
  return { ...s, parts };
}

function lineOf(syllables, timed) {
  syllables = [...syllables.slice(0, -1), trimEnd(syllables.at(-1))];
  return { start: syllables[0].start, end: syllables.at(-1).end, timed, syllables };
}

/**
 * Split lines wider than `maxEm` (in em of the lyric font) into several lines.
 * @param {import('./lyrics.js').Line[]} lines
 * @returns {import('./lyrics.js').Line[]}
 */
export function wrapLines(lines, maxEm) {
  if (!(maxEm > 0)) return lines;
  const out = [];
  const split = (line) => {
    const syl = line.syllables;
    const widths = syl.map(syllableWidth);
    const total = widths.reduce((a, b) => a + b, 0);
    if (total <= maxEm || syl.length < 2 || !line.timed) return out.push(line);
    let best = -1;
    let bestCost = Infinity;
    let left = 0;
    for (let k = 1; k < syl.length; k++) {
      left += widths[k - 1];
      const text = syl[k - 1].parts.map((p) => p.base).join('');
      const kind = /\s$/u.test(text) ? 0 : PUNCT.test(text) ? 0.5 : syl[k].start - syl[k - 1].end > 0.25 ? 1 : 3;
      const cost = Math.abs(left - total / 2) / total + kind * 0.15 + (Math.max(left, total - left) > maxEm ? 1 : 0);
      if (cost < bestCost) [best, bestCost] = [k, cost];
    }
    split(lineOf(syl.slice(0, best), true));
    split(lineOf(syl.slice(best), true));
  };
  lines.forEach(split);
  return out;
}
