<script>
  // Lyric timing tool: play the instrumental and press a key on every syllable.
  //
  // Tap mode (default): key down = this syllable starts (and the previous one in the
  //   line ends); for the last syllable of a line, key up = the line ends, so hold it.
  // Hold mode: key down = start, key up = end, for every syllable.
  import { onMount, tick } from 'svelte';
  import { Button, Segmented, Toaster, toast } from '../lib/ui/index.js';
  import Nav from '../lib/Nav.svelte';
  import KaraokeStage from '../lib/KaraokeStage.svelte';
  import YouTubeRef from '../lib/YouTubeRef.svelte';
  import AudioRef from '../lib/AudioRef.svelte';
  import { api, clock } from '../lib/client.js';
  import { formatTime, lyricsToText, parseLyrics, partsToMarkup, serializeLrc, skeletonFromText } from '../lib/lyrics.js';
  import { stageVars } from '../lib/theme.js';

  const params = new URLSearchParams(location.search);
  const TAP_KEYS = new Set(['Space', 'KeyF', 'KeyJ']);

  let songs = $state([]);
  let songId = $state(params.get('song') || '');
  let song = $state(null);
  let text = $state('');
  /** @type {{ syllables: { parts: any[], start: number | null, end: number | null }[] }[]} */
  let lines = $state([]);
  let ptr = $state({ l: 0, s: 0 });
  let held = null;
  let mode = $state('tap');
  let latency = $state(Number(localStorage.getItem('karaoke.latency') ?? 0.05));
  let rate = $state('1');
  let time = $state(0);
  let duration = $state(NaN);
  let playing = $state(false);
  let dirty = $state(false);
  let listEl = $state();
  let refUrl = $state('');
  let refOffset = $state(0);
  let refMix = $state('both');
  let refSource = $state('none');
  let refAudioSrc = $state(null);
  /** @type {HTMLAudioElement} */
  let audio;

  $effect(() => localStorage.setItem('karaoke.latency', String(latency)));
  $effect(() => {
    if (audio) audio.playbackRate = Number(rate);
  });

  let total = $derived(lines.reduce((n, l) => n + l.syllables.length, 0));
  let timedCount = $derived(lines.reduce((n, l) => n + l.syllables.filter((s) => s.start != null && s.end != null).length, 0));

  // Lines usable for the preview / export: every syllable has a start; missing ends
  // are filled from the next start.
  let timedLines = $derived.by(() => {
    const out = [];
    for (const l of lines) {
      if (!l.syllables.length || l.syllables.some((s) => s.start == null)) continue;
      const syllables = l.syllables.map((s, i) => {
        const next = l.syllables[i + 1]?.start;
        const end = s.end ?? next ?? s.start + 0.4;
        return { parts: s.parts, start: s.start, end: Math.max(end, s.start) };
      });
      out.push({ start: syllables[0].start, end: syllables.at(-1).end, syllables, timed: true });
    }
    return out.sort((a, b) => a.start - b.start);
  });
  let preview = $derived({ meta: {}, offset: 0, lines: timedLines });

  async function loadSong(id) {
    if (!id) return;
    if (dirty && !confirm('還沒儲存，確定要換歌？')) return;
    song = await api.song(id);
    songId = id;
    history.replaceState(null, '', `?song=${encodeURIComponent(id)}`);
    const parsed = song.lyricsText && !/\.txt$/i.test(song.lyrics || '') ? parseLyrics(song.lyricsText, song.lyrics) : null;
    const hasTiming = parsed?.lines.some((l) => l.timed);
    text = song.lyricsSource || (parsed && parsed.lines.length ? lyricsToText(parsed) : song.lyricsText || '');
    lines = merge(skeletonFromText(text), hasTiming ? parsed.lines : []);
    audio.src = song.audioUrl || '';
    refUrl = song.reference?.url || '';
    refAudioSrc = song.referenceAudioUrl || null;
    refSource = song.reference?.source || (refUrl ? 'youtube' : refAudioSrc ? 'file' : 'none');
    refOffset = Number(song.reference?.offset || 0);
    time = 0;
    ptr = firstUntimed();
    dirty = false;
  }

  /** Copy times from already-timed lines onto a fresh skeleton (matched by line text). */
  function merge(skeleton, timed) {
    let j = 0;
    return skeleton.map((line) => {
      const key = line.syllables.map((s) => partsToMarkup(s.parts)).join('|');
      for (let k = j; k < timed.length; k++) {
        const tk = timed[k].syllables.map((s) => partsToMarkup(s.parts)).join('|');
        if (tk === key) {
          j = k + 1;
          return { syllables: line.syllables.map((s, i) => ({ ...s, start: timed[k].syllables[i].start, end: timed[k].syllables[i].end })) };
        }
      }
      return { syllables: line.syllables.map((s) => ({ ...s, start: null, end: null })) };
    });
  }

  function applyText() {
    const done = lines.filter((l) => l.syllables.length && l.syllables.every((s) => s.start != null));
    lines = merge(skeletonFromText(text), done);
    ptr = firstUntimed();
    dirty = true;
  }

  function firstUntimed() {
    for (let l = 0; l < lines.length; l++) {
      const s = lines[l].syllables.findIndex((x) => x.start == null);
      if (s >= 0) return { l, s };
    }
    return { l: lines.length, s: 0 };
  }

  function step(p, dir) {
    if (p.l >= lines.length) {
      if (dir > 0 || !lines.length) return p;
      return { l: lines.length - 1, s: lines.at(-1).syllables.length - 1 };
    }
    let { l, s } = p;
    s += dir;
    while (l >= 0 && l < lines.length && (s < 0 || s >= lines[l].syllables.length)) {
      if (s < 0) {
        l -= 1;
        s = l >= 0 ? lines[l].syllables.length - 1 : 0;
      } else {
        l += 1;
        s = 0;
      }
    }
    if (l < 0) return { l: 0, s: 0 };
    return { l: Math.min(l, lines.length), s };
  }

  const now = () => Math.max(0, audio.currentTime - latency * audio.playbackRate);

  function tapDown() {
    if (ptr.l >= lines.length) return;
    const t = now();
    const line = lines[ptr.l];
    const syl = line.syllables[ptr.s];
    syl.start = t;
    syl.end = null;
    const prev = line.syllables[ptr.s - 1];
    if (prev && mode === 'tap') prev.end = t;
    if (prev && prev.end == null) prev.end = t;
    held = { l: ptr.l, s: ptr.s };
    ptr = step(ptr, 1);
    dirty = true;
    scrollToPtr();
  }

  function tapUp() {
    if (!held) return;
    const line = lines[held.l];
    const syl = line.syllables[held.s];
    const last = held.s === line.syllables.length - 1;
    if (mode === 'hold' || last) syl.end = Math.max(syl.start, now());
    held = null;
  }

  function undo() {
    const p = step(ptr, -1);
    if (ptr.l === 0 && ptr.s === 0) return;
    const syl = lines[p.l].syllables[p.s];
    const back = syl.start;
    syl.start = null;
    syl.end = null;
    const prev = lines[p.l].syllables[p.s - 1];
    if (prev && mode === 'tap') prev.end = null;
    ptr = p;
    if (back != null) audio.currentTime = Math.max(0, back - 2);
    dirty = true;
  }

  function jumpTo(l, s) {
    ptr = { l, s };
    const syl = lines[l].syllables[s];
    let t = syl.start;
    if (t == null) {
      const p = step({ l, s }, -1);
      t = lines[p.l]?.syllables[p.s]?.end ?? lines[p.l]?.syllables[p.s]?.start ?? 0;
    }
    audio.currentTime = Math.max(0, t - 2);
  }

  function clearFrom() {
    for (let l = ptr.l; l < lines.length; l++) {
      lines[l].syllables.forEach((s, i) => {
        if (l > ptr.l || i >= ptr.s) {
          s.start = null;
          s.end = null;
        }
      });
    }
    dirty = true;
  }

  function shift(delta, onlyLine = null) {
    lines.forEach((line, l) => {
      if (onlyLine != null && l !== onlyLine) return;
      for (const s of line.syllables) {
        if (s.start != null) s.start = Math.max(0, s.start + delta);
        if (s.end != null) s.end = Math.max(0, s.end + delta);
      }
    });
    dirty = true;
  }

  async function save() {
    if (!song) return;
    const lyrics = { meta: { ti: song.title, ar: song.artist }, offset: 0, lines: timedLines };
    try {
      if (timedLines.length) await api.saveLyrics(song.id, serializeLrc(lyrics), 'lyrics.lrc');
      const full = await api.song(song.id);
      delete full.lyricsText;
      full.lyricsSource = text;
      full.reference = { ...(full.reference || {}), url: refUrl.trim(), offset: refOffset, source: refSource };
      if (!timedLines.length && !full.hasLyrics) full.lyrics = 'lyrics.lrc';
      await api.save(full);
      dirty = false;
      const missing = lines.length - timedLines.length;
      toast({
        title: '已儲存',
        body: missing ? `${timedLines.length} 行已對時，${missing} 行還沒對完（只存了文字）` : `${timedLines.length} 行，lyrics.lrc`,
        tone: missing ? 'warn' : 'success',
      });
    } catch (e) {
      toast({ title: '儲存失敗', body: e.message, tone: 'warn' });
    }
  }

  async function scrollToPtr() {
    await tick();
    listEl?.querySelector('.ptr')?.scrollIntoView({ block: 'nearest', behavior: 'smooth' });
  }

  function onKeyDown(e) {
    if (e.target instanceof HTMLTextAreaElement || e.target instanceof HTMLInputElement || e.target instanceof HTMLSelectElement) return;
    if (TAP_KEYS.has(e.code)) {
      e.preventDefault();
      if (!e.repeat) tapDown();
      return;
    }
    const map = {
      Enter: () => (audio.paused ? audio.play() : audio.pause()),
      KeyP: () => (audio.paused ? audio.play() : audio.pause()),
      Backspace: undo,
      ArrowLeft: () => (audio.currentTime = Math.max(0, audio.currentTime - 3)),
      ArrowRight: () => (audio.currentTime += 3),
    };
    if (map[e.code]) {
      e.preventDefault();
      map[e.code]();
    }
  }

  function onKeyUp(e) {
    if (e.target instanceof HTMLTextAreaElement || e.target instanceof HTMLInputElement) return;
    if (TAP_KEYS.has(e.code)) {
      e.preventDefault();
      tapUp();
    }
  }

  function isNow(s) {
    return s.start != null && time >= s.start && time < (s.end ?? s.start + 0.3);
  }

  onMount(() => {
    let raf;
    const loop = () => {
      time = audio.currentTime;
      raf = requestAnimationFrame(loop);
    };
    raf = requestAnimationFrame(loop);
    api.songs().then((s) => (songs = s));
    if (songId) loadSong(songId);
    const before = (e) => {
      if (dirty) e.preventDefault();
    };
    addEventListener('beforeunload', before);
    return () => {
      cancelAnimationFrame(raf);
      removeEventListener('beforeunload', before);
    };
  });
</script>

<svelte:window onkeydown={onKeyDown} onkeyup={onKeyUp} />

<audio
  bind:this={audio}
  preload="auto"
  onplay={() => (playing = true)}
  onpause={() => (playing = false)}
  ondurationchange={() => (duration = audio.duration)}
></audio>

<Nav current="timing" />
<div class="wrap">
  <section class="card">
    <div class="row">
      <select value={songId} onchange={(e) => loadSong(e.currentTarget.value)}>
        <option value="">選擇歌曲…</option>
        {#each songs as s}<option value={s.id}>{s.title}{s.artist ? ` — ${s.artist}` : ''}</option>{/each}
      </select>
      <span class="grow"></span>
      <span class="muted">{timedCount} / {total} 音節</span>
      <Button onclick={save} disabled={!song}>{dirty ? '儲存 *' : '儲存'}</Button>
    </div>
  </section>

  {#if song}
    <div class="cols">
      <div>
        <div class="stage-box" style={stageVars({ size: 9 })}>
          <KaraokeStage lyrics={preview} {time} {song} />
        </div>

        <section class="card transport">
          <div class="row">
            <Button size="sm" onclick={() => (audio.paused ? audio.play() : audio.pause())} en="Enter">{playing ? '暫停' : '播放'}</Button>
            <Button size="sm" variant="ghost" onclick={() => (audio.currentTime = Math.max(0, audio.currentTime - 3))} en="Left">-3 秒</Button>
            <Button size="sm" variant="ghost" onclick={() => (audio.currentTime += 3)} en="Right">+3 秒</Button>
            <Button size="sm" variant="ghost" onclick={undo} en="Backspace">退一個</Button>
            <span class="ui-num">{clock(time)}.{String(Math.floor((time % 1) * 100)).padStart(2, '0')} / {clock(duration)}</span>
          </div>
          <input class="seek" type="range" min="0" max={duration || 0} step="0.01" value={time} oninput={(e) => (audio.currentTime = Number(e.currentTarget.value))} />
          <div class="row">
            <Segmented size="sm" label="速度" options={[{ value: '1', label: '1×' }, { value: '0.75', label: '0.75×' }, { value: '0.5', label: '0.5×' }]} bind:value={rate} />
            <Segmented size="sm" label="打點方式" options={[{ value: 'tap', label: '點擊' }, { value: 'hold', label: '按住' }]} bind:value={mode} />
            <label class="field inline">反應補償（秒）<input type="number" step="0.01" min="0" max="0.5" bind:value={latency} /></label>
          </div>
          <p class="muted">
            <kbd>Space</kbd>／<kbd>F</kbd>／<kbd>J</kbd> 打點：
            {mode === 'tap' ? '按下＝這個音節開始；每行最後一個音節要按住到唱完再放開。' : '按下＝開始，放開＝結束。'}
            點下面的音節可以從那裡重打（會倒回 2 秒）。
          </p>
          <div class="row">
            <Button size="sm" variant="ghost" onclick={() => shift(-0.05)}>全部提早 0.05</Button>
            <Button size="sm" variant="ghost" onclick={() => shift(0.05)}>全部延後 0.05</Button>
            <Button size="sm" variant="ghost" onclick={clearFrom}>清除游標之後</Button>
          </div>
        </section>
      </div>

      <div>
      <section class="card">
        <h2>參考音源</h2>
        <Segmented
          size="sm"
          label="來源"
          options={[
            { value: 'none', label: '不用' },
            { value: 'youtube', label: 'YouTube' },
            { value: 'file', label: '本機音檔' },
          ]}
          bind:value={refSource}
        />
        {#if refSource === 'youtube'}
          <YouTubeRef {audio} bind:url={refUrl} offset={refOffset} mix={refMix} />
        {:else if refSource === 'file'}
          <AudioRef {audio} songId={song.id} bind:src={refAudioSrc} offset={refOffset} mix={refMix} />
        {/if}
        {#if refSource !== 'none'}
          <div class="row refctl">
            <label class="field inline"
              >聲音
              <select bind:value={refMix}>
                <option value="both">伴奏＋參考</option>
                <option value="reference">只聽參考</option>
                <option value="instrumental">只聽伴奏</option>
              </select>
            </label>
            <span class="muted">參考比伴奏晚 {refOffset.toFixed(2)} 秒</span>
            {#each [-0.5, -0.05, 0.05, 0.5] as d}
              <button class="mini" onclick={() => ((refOffset = +(refOffset + d).toFixed(2)), (dirty = true))}>{d > 0 ? '＋' : '−'}{Math.abs(d)}</button>
            {/each}
          </div>
          <p class="muted">參考會跟著伴奏播放、暫停、跳轉與變速。先選「伴奏＋參考」，調偏移到兩邊節拍重疊，再開始打點。</p>
        {/if}
      </section>
      <section class="card text">
        <h2>歌詞文字</h2>
        <textarea rows="14" bind:value={text} oninput={() => (dirty = true)} spellcheck="false"></textarea>
        <p class="muted">
          一行一句。注音寫成 <code>{'{漢字|かんじ}'}</code>（整組）或 <code>{'{漢字|かん|じ}'}</code>（每字各自打點）。
          小字假名、標點與英文單字會自動併進前一個音節。
        </p>
        <Button size="sm" variant="ink" onclick={applyText}>套用文字（已打的點會保留）</Button>
      </section>
      </div>
    </div>

    <section class="card">
      <h2>音節</h2>
      <div class="lines" bind:this={listEl}>
        {#each lines as line, l}
          <div class="line" class:current={l === ptr.l}>
            <span class="no ui-num">{l + 1}</span>
            <div class="syls">
              {#each line.syllables as s, i}
                <button
                  class="syl"
                  class:timed={s.start != null}
                  class:ptr={l === ptr.l && i === ptr.s}
                  class:now={isNow(s)}
                  onclick={() => jumpTo(l, i)}
                  title={s.start != null ? `${formatTime(s.start)} → ${s.end != null ? formatTime(s.end) : '?'}` : '未對時'}
                >
                  <span class="txt">{#each s.parts as p}{#if p.ruby}<ruby>{p.base}<rt>{p.ruby}</rt></ruby>{:else}{p.base}{/if}{/each}</span>
                  <small>{s.start != null ? s.start.toFixed(2) : '·'}</small>
                </button>
              {/each}
            </div>
            <span class="lineops">
              <button class="mini" title="這行提早 0.05 秒" onclick={() => shift(-0.05, l)}>−</button>
              <button class="mini" title="這行延後 0.05 秒" onclick={() => shift(0.05, l)}>＋</button>
            </span>
          </div>
        {/each}
        {#if ptr.l >= lines.length && lines.length}
          <p class="ok">全部對完了，記得儲存。</p>
        {/if}
      </div>
    </section>
  {:else}
    <p class="muted">先選一首歌（在「曲庫」新增歌曲並上傳伴奏）。</p>
  {/if}
</div>
<Toaster />

<style>
  .cols {
    display: grid;
    grid-template-columns: minmax(0, 1.4fr) minmax(0, 1fr);
    gap: var(--ui-space-4);
  }
  @media (max-width: 900px) {
    .cols {
      grid-template-columns: 1fr;
    }
  }
  .stage-box {
    position: relative;
    aspect-ratio: 16 / 9;
    margin-bottom: var(--ui-space-4);
    background:
      radial-gradient(ellipse at 30% 20%, #2b3f8f 0%, transparent 60%),
      linear-gradient(160deg, #10183a, #05070c);
  }
  .refctl .mini {
    width: auto;
    padding: 2px 6px;
  }
  .refctl {
    margin-top: var(--ui-space-2);
    gap: 6px;
  }
  .seek {
    width: 100%;
    margin: var(--ui-space-3) 0;
  }
  .field.inline {
    flex-direction: row;
    align-items: center;
  }
  .field.inline input {
    width: 5em;
  }
  .text h2 {
    margin-top: 0;
  }
  .lines {
    max-height: 60vh;
    overflow: auto;
  }
  .line {
    display: flex;
    gap: var(--ui-space-2);
    align-items: flex-start;
    padding: 6px 4px;
    border-bottom: 1px solid var(--ui-line);
  }
  .line.current {
    background: color-mix(in srgb, var(--ui-blue-soft) 50%, transparent);
  }
  .no {
    width: 2em;
    color: var(--ui-ink-3);
    padding-top: 1.1em;
  }
  .syls {
    display: flex;
    flex-wrap: wrap;
    gap: 3px;
    flex: 1;
  }
  .syl {
    display: flex;
    flex-direction: column;
    align-items: center;
    justify-content: flex-end;
    min-width: 2.2em;
    padding: 2px 4px;
    font: inherit;
    font-size: 1.15rem;
    white-space: pre;
    border: 1px solid var(--ui-line-2);
    background: var(--ui-surface);
    color: var(--ui-ink-3);
    cursor: pointer;
  }
  .syl rt {
    font-size: 0.55em;
  }
  .syl small {
    font-family: var(--ui-font-mono);
    font-size: 0.62rem;
    color: var(--ui-ink-3);
  }
  .syl.timed {
    color: var(--ui-ink);
    border-color: var(--ui-blue);
  }
  .syl.now {
    background: var(--ui-blue);
    color: var(--ui-on-blue);
  }
  .syl.now small {
    color: var(--ui-on-blue);
  }
  .syl.ptr {
    outline: 3px solid var(--ui-yellow);
    outline-offset: 1px;
  }
  .lineops {
    display: flex;
    gap: 2px;
    padding-top: 1em;
  }
  .mini {
    width: 1.8em;
    border: 1px solid var(--ui-line-2);
    background: var(--ui-surface);
    color: var(--ui-ink-2);
    cursor: pointer;
  }
</style>
