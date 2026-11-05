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
