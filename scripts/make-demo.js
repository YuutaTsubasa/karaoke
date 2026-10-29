// Builds the demo song in examples/demo: an original melody and lyrics (CC0),
// synthesized into instrumental.wav, with lyrics.lrc timed exactly to the notes.
// Run with `npm run demo` (the dev server also runs it when the wav is missing).

import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { parseRuby, serializeLrc } from '../src/lib/lyrics.js';

const BPM = 100;
const BEAT = 60 / BPM;
const RATE = 32000;

// [syllable markup, [[note, beats], ...]] ; each line is sung from `at` (in beats)
const LINES = [
  { at: 16, units: [['{青|あお}', [['E4', 0.5], ['G4', 0.5]]], ['い', [['G4', 1]]], ['{風|かぜ}', [['A4', 0.5], ['G4', 0.5]]], ['が', [['E4', 1]]], ['{空|そら}', [['C5', 0.5], ['B4', 0.5]]], ['を', [['A4', 0.5]]], ['{駆|か}', [['G4', 0.5]]], ['け', [['A4', 0.5]]], ['る', [['G4', 1]]]] },
  { at: 24, units: [['{光|ひかり}', [['F4', 0.5], ['A4', 0.5], ['C5', 0.5]]], ['の', [['C5', 0.5]]], ['{道|みち}', [['D5', 0.5], ['C5', 0.5]]], ['を', [['A4', 1]]], ['{追|お}', [['G4', 0.5]]], ['い', [['A4', 0.5]]], ['か', [['G4', 0.5]]], ['け', [['E4', 0.5]]], ['て', [['D4', 1]]]] },
  { at: 32, units: [['きっ', [['E4', 0.5]]], ['と', [['G4', 0.5]]], ['{明日|あした}', [['C5', 0.5], ['C5', 0.5], ['B4', 0.5]]], ['も', [['A4', 0.5]]], ['{歌|うた}', [['G4', 0.5], ['A4', 0.5]]], ['え', [['B4', 0.5]]], ['る', [['C5', 0.5]]], ['よ', [['D5', 2]]]] },
  { at: 40, units: [['{君|きみ}', [['E5', 0.5], ['D5', 0.5]]], ['と', [['C5', 0.5]]], ['{一|いっ}', [['A4', 0.5]]], ['{緒|しょ}', [['C5', 1]]], ['に ', [['D5', 1]]], ['ラ', [['E5', 0.5]]], ['ラ', [['D5', 0.5]]], ['ラ', [['C5', 2]]]] },
  { at: 56, units: [['今', [['C5', 0.5]]], ['天', [['C5', 0.5]]], ['也', [['A4', 1]]], ['一', [['G4', 0.5]]], ['起', [['A4', 0.5]]], ['唱', [['C5', 1]]], ['歌', [['D5', 1]]], ['吧', [['E5', 2]]]] },
  { at: 64, units: [['Sing ', [['E5', 1]]], ['along ', [['D5', 0.5], ['C5', 0.5]]], ['with ', [['A4', 1]]], ['me ', [['C5', 1]]], ['tonight', [['D5', 0.5], ['D5', 1.5]]]] },
];
const CHORDS = ['C', 'Am', 'F', 'G']; // one per bar, repeating
const CHORD_NOTES = { C: ['C3', 'E3', 'G3'], Am: ['A2', 'C3', 'E3'], F: ['F2', 'A2', 'C3'], G: ['G2', 'B2', 'D3'] };
const TOTAL_BEATS = 76;

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const outDir = path.join(root, 'examples', 'demo');

export function buildDemo({ force = false } = {}) {
  fs.mkdirSync(outDir, { recursive: true });
  const lines = LINES.map(({ at, units }) => {
    let beat = at;
    const syllables = units.map(([markup, notes]) => {
      const len = notes.reduce((a, [, b]) => a + b, 0);
      const s = { parts: parseRuby(markup), start: beat * BEAT, end: (beat + len) * BEAT };
      beat += len;
      return s;
    });
    return { start: syllables[0].start, end: syllables.at(-1).end, syllables, timed: true };
  });
  const lrc = serializeLrc({ meta: { ti: '青い風（示範曲）', ar: '悠太翼', by: 'make-demo.js' }, offset: 0, lines });
  fs.writeFileSync(path.join(outDir, 'lyrics.lrc'), lrc);

  const wav = path.join(outDir, 'instrumental.wav');
  if (force || !fs.existsSync(wav)) fs.writeFileSync(wav, synth());
  return outDir;
}

function freq(note) {
  const m = /^([A-G])(#?)(\d)$/.exec(note);
  const semis = { C: 0, D: 2, E: 4, F: 5, G: 7, A: 9, B: 11 }[m[1]] + (m[2] ? 1 : 0);
  const midi = (Number(m[3]) + 1) * 12 + semis;
  return 440 * 2 ** ((midi - 69) / 12);
}

function synth() {
  const n = Math.ceil((TOTAL_BEATS * BEAT + 1.5) * RATE);
  const buf = new Float32Array(n);
  const tone = (f, t0, dur, gain, shape, attack = 0.01, release = 0.08) => {
    const i0 = Math.floor(t0 * RATE);
    const len = Math.floor((dur + release) * RATE);
    for (let i = 0; i < len && i0 + i < n; i++) {
      const t = i / RATE;
      const ph = (f * t) % 1;
      let v;
      if (shape === 'square') v = (ph < 0.5 ? 1 : -1) * 0.6 + Math.sin(2 * Math.PI * ph) * 0.4;
      else if (shape === 'tri') v = 1 - 4 * Math.abs(ph - 0.5);
      else v = Math.sin(2 * Math.PI * ph);
      const env = Math.min(1, t / attack) * (t > dur ? Math.max(0, 1 - (t - dur) / release) : 1) * Math.exp(-t * (shape === 'sine' ? 1.5 : 0.6));
      buf[i0 + i] += v * env * gain;
    }
  };
  const noise = (t0, dur, gain) => {
    const i0 = Math.floor(t0 * RATE);
    let last = 0;
    for (let i = 0; i < dur * RATE && i0 + i < n; i++) {
      const w = Math.random() * 2 - 1;
      const hp = w - last;
      last = w;
      buf[i0 + i] += hp * gain * Math.exp((-i / RATE) * 60);
    }
  };
  const kick = (t0) => {
    const i0 = Math.floor(t0 * RATE);
    let ph = 0;
    for (let i = 0; i < 0.25 * RATE && i0 + i < n; i++) {
      const t = i / RATE;
      ph += (50 + 100 * Math.exp(-t * 30)) / RATE;
      buf[i0 + i] += Math.sin(2 * Math.PI * ph) * Math.exp(-t * 14) * 0.5;
    }
  };

  const bars = TOTAL_BEATS / 4;
  for (let bar = 0; bar < bars; bar++) {
    const t = bar * 4 * BEAT;
    const last = bar === bars - 1;
    const chord = last ? 'C' : CHORDS[bar % 4];
    for (const note of CHORD_NOTES[chord]) tone(freq(note) * 2, t, (last ? 4 : 3.8) * BEAT, 0.07, 'tri', 0.05, 0.3);
    const rootNote = CHORD_NOTES[chord][0];
    for (const b of last ? [0] : [0, 1.5, 2, 3]) tone(freq(rootNote) / 2, t + b * BEAT, (last ? 3 : 0.45) * BEAT, 0.35, 'tri', 0.005, 0.05);
    if (last) continue;
    kick(t);
    kick(t + 2 * BEAT);
    for (let e = 0; e < 8; e++) noise(t + e * 0.5 * BEAT, 0.05, e % 2 ? 0.08 : 0.12);
    if (bar < 4) noise(t + 3.5 * BEAT, 0.12, 0.2); // intro accent
  }
  // lead melody, quiet, so the sync can be checked by ear
  for (const { at, units } of LINES) {
    let beat = at;
    for (const [, notes] of units) {
      for (const [note, len] of notes) {
        tone(freq(note), beat * BEAT, len * BEAT * 0.92, 0.13, 'square', 0.01, 0.06);
        beat += len;
      }
    }
  }
  let peak = 0;
  for (const v of buf) peak = Math.max(peak, Math.abs(v));
  const scale = 0.89 / (peak || 1);
  const data = Buffer.alloc(44 + n * 2);
  data.write('RIFF', 0);
  data.writeUInt32LE(36 + n * 2, 4);
  data.write('WAVEfmt ', 8);
  data.writeUInt32LE(16, 16);
  data.writeUInt16LE(1, 20);
  data.writeUInt16LE(1, 22);
  data.writeUInt32LE(RATE, 24);
  data.writeUInt32LE(RATE * 2, 28);
  data.writeUInt16LE(2, 32);
  data.writeUInt16LE(16, 34);
  data.write('data', 36);
  data.writeUInt32LE(n * 2, 40);
  for (let i = 0; i < n; i++) data.writeInt16LE(Math.round(Math.max(-1, Math.min(1, buf[i] * scale)) * 32767), 44 + i * 2);
  return data;
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  console.log('demo written to', buildDemo({ force: true }));
}
