import { test } from 'node:test';
import assert from 'node:assert/strict';
import { lineText, lyricsToText, parseLyrics, parseRuby, serializeLrc, skeletonFromText, splitSyllables } from '../src/lib/lyrics.js';
import { schedule, wrapLines } from '../src/lib/schedule.js';

test('ruby: group and mono', () => {
  assert.deepEqual(parseRuby('{明日|あした}も'), [
    { base: '明日', ruby: 'あした' },
    { base: 'も', ruby: null },
  ]);
  assert.deepEqual(parseRuby('{一緒|いっ|しょ}'), [
    { base: '一', ruby: 'いっ' },
    { base: '緒', ruby: 'しょ' },
  ]);
});

test('enhanced LRC with ruby, gaps and break markers', () => {
  const text = [
    '[ti:Test]',
    '[offset:-120]',
    '[00:01.00]<00:01.00>{青|あお}<00:01.50>い<00:02.00><00:02.40>風<00:03.00>',
    '[00:03.00]',
    '[00:10.00]plain line',
  ].join('\n');
  const l = parseLyrics(text);
  assert.equal(l.meta.ti, 'Test');
  assert.equal(l.offset, -0.12);
  assert.equal(l.lines.length, 2);
  const [a, b] = l.lines;
  assert.equal(lineText(a), '青い風');
  assert.deepEqual(
    a.syllables.map((s) => [s.start, s.end]),
    [
      [1, 1.5],
      [1.5, 2],
      [2.4, 3],
    ],
  );
  assert.equal(a.syllables[0].parts[0].ruby, 'あお');
  assert.equal(b.timed, false);
  assert.equal(b.start, 10);
});

test('serialize round trip keeps timing', () => {
  const src = '[00:01.00]<00:01.00>{青|あお}<00:01.50>い<00:02.00><00:02.40>風<00:03.00>\n';
  const once = parseLyrics(src);
  const again = parseLyrics(serializeLrc(once));
  assert.deepEqual(again.lines, once.lines);
});

test('ASS \\k karaoke import', () => {
  const ass = [
    '[Script Info]',
    'Title: k',
    '[Events]',
    'Format: Layer, Start, End, Style, Name, MarginL, MarginR, MarginV, Effect, Text',
    'Dialogue: 0,0:00:05.00,0:00:07.00,Default,,0,0,0,,{\\k50}か{\\k50}ら{\\kf100}お, け',
  ].join('\n');
  const l = parseLyrics(ass, 'x.ass');
  assert.equal(l.lines.length, 1);
  assert.deepEqual(
    l.lines[0].syllables.map((s) => [lineText({ syllables: [s] }), s.start, s.end]),
    [
      ['か', 5, 5.5],
      ['ら', 5.5, 6],
      ['お, け', 6, 7],
    ],
  );
});

test('syllable splitting', () => {
  const units = (s) => splitSyllables(s).map((u) => u.map((p) => p.base).join(''));
  assert.deepEqual(units('きっとしゃべる'), ['きっ', 'と', 'しゃ', 'べ', 'る']);
  assert.deepEqual(units('{一緒|いっ|しょ}に ラー'), ['一', '緒', 'に ', 'ラー']);
  assert.deepEqual(units('Sing along、「夢」'), ['Sing ', 'along、', '「夢」']);
  assert.deepEqual(units('今天也唱'), ['今', '天', '也', '唱']);
});

test('skeleton keeps markup text', () => {
  const text = '{青|あお}い{風|かぜ}\nラララ';
  const lyrics = { lines: skeletonFromText(text) };
  assert.equal(lyricsToText(lyrics), text);
});

test('schedule alternates rows and resets after a break', () => {
  const mk = (start, end) => ({ start, end, syllables: [], timed: true });
  const lines = [mk(10, 14), mk(14.5, 18), mk(18.5, 22), mk(40, 44), mk(44.5, 48)];
  const plan = schedule(lines);
  assert.deepEqual(
    plan.map((p) => p.row),
    [0, 1, 0, 0, 1],
  );
  // line 3 (row 0) only appears after line 1 (row 0) is done
  assert.ok(plan[2].show >= lines[0].end);
  assert.ok(plan[2].show < lines[2].start);
  // countdown before the first line and after the break
  assert.ok(plan[0].countdown != null && plan[3].countdown != null);
  assert.equal(plan[1].countdown, null);
  // no two visible lines share a row at any time
  for (let t = 0; t < 50; t += 0.05) {
    const rows = plan.filter((p) => t >= p.show && t < p.hide).map((p) => p.row);
    assert.equal(new Set(rows).size, rows.length, `overlap at ${t}`);
  }
});

test('long lines split at a phrase break near the middle', () => {
  const [line] = skeletonFromText('{君|きみ}の{手|て}は　どうしてこんなにも{温|あたた}かいの？');
  line.syllables.forEach((s, i) => Object.assign(s, { start: i, end: i + 0.9 }));
  const parts = wrapLines([line], 16);
  assert.equal(parts.length, 2);
  assert.equal(lineText(parts[0]), '君の手は');
  assert.equal(lineText(parts[1]), 'どうしてこんなにも温かいの？');
  assert.equal(parts[1].start, 4);
  assert.equal(parts[0].end, parts[0].syllables.at(-1).end);
  // short lines are left alone
  assert.equal(wrapLines([line], 40)[0], line);
});

test('long lines are never broken inside a phrase', () => {
  const [line] = skeletonFromText('{僕|ぼく}のため　{君|きみ}のための　{涙|なみだ}を{流|なが}すよ');
  line.syllables.forEach((s, i) => Object.assign(s, { start: i * 0.3, end: i * 0.3 + 0.3 }));
  assert.deepEqual(wrapLines([line], 11).map(lineText), ['僕のため　君のための', '涙を流すよ']);
  // no space, no pause: shrink instead of cutting a word
  const [solid] = skeletonFromText('あなんて{美|うつく}しいんだろういつまでも');
  solid.syllables.forEach((s, i) => Object.assign(s, { start: i * 0.3, end: i * 0.3 + 0.3 }));
  assert.equal(wrapLines([solid], 8).length, 1);
});
