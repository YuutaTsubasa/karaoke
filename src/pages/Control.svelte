<script>
  // Live control page. Open it in a browser, or add it to OBS as a Custom Browser Dock
  // (Docks → Custom Browser Docks) so the shortcuts work while OBS is focused.
  import { onMount } from 'svelte';
  import { Button, StatusLamp, Toaster, toast } from 'bluebolt-ui';
  import Nav from '../lib/Nav.svelte';
  import { api, clock, listen, today } from '../lib/client.js';
  import { FONTS, THEMES } from '../lib/theme.js';

  let songs = $state([]);
  let status = $state(null);
  let players = $state(0);
  let connected = $state(false);
  let query = $state('');
  let queue = $state(load('karaoke.queue', []));
  let streamTitle = $state(load('karaoke.streamTitle', ''));
  let look = $state(load('karaoke.look', { theme: 'blue', font: 'rounded', size: 8, bottom: 6 }));

  function load(key, fallback) {
    try {
      return JSON.parse(localStorage.getItem(key)) ?? fallback;
    } catch {
      return fallback;
    }
  }
  $effect(() => localStorage.setItem('karaoke.queue', JSON.stringify(queue)));
  $effect(() => localStorage.setItem('karaoke.streamTitle', JSON.stringify(streamTitle)));
  $effect(() => localStorage.setItem('karaoke.look', JSON.stringify(look)));

  let filtered = $derived.by(() => {
    const q = query.trim().toLowerCase();
    if (!q) return songs;
    return songs.filter((s) => `${s.title} ${s.artist} ${(s.tags || []).join(' ')}`.toLowerCase().includes(q));
  });
  let current = $derived(songs.find((s) => s.id === status?.songId));
  let playerUrl = $derived(
    `${location.origin}/player.html?theme=${look.theme}&font=${look.font}&size=${look.size}&bottom=${look.bottom}`,
  );

  async function refresh() {
    songs = await api.songs();
  }

  async function send(action, extra = {}) {
    try {
      const r = await api.command({ action, ...extra });
      if (!r.players) toast({ title: '沒有播放器在線上', body: '在 OBS 加入播放器網址（或用瀏覽器打開）', tone: 'warn' });
    } catch (e) {
      toast({ title: '指令失敗', body: e.message, tone: 'warn' });
    }
  }

  function cue(song, autoplay = false) {
    send('load', { id: song.id, autoplay });
  }

  function enqueue(song) {
    queue = [...queue, song.id];
  }

  function next() {
    const [id, ...rest] = queue;
    if (!id) return toast({ title: '佇列是空的' });
    queue = rest;
    send('load', { id, autoplay: true });
  }

  async function markSung() {
    if (!current) return;
    const full = await api.song(current.id);
    delete full.lyricsText;
    const entry = { date: today(), title: streamTitle.trim() };
    if ((full.performances || []).some((p) => p.date === entry.date && p.title === entry.title)) {
      return toast({ title: '今天已經記錄過了' });
    }
    full.performances = [...(full.performances || []), entry];
    await api.save(full);
    await refresh();
    toast({ title: `已記錄：${current.title}`, body: `${entry.date} ${entry.title}`, tone: 'success' });
  }

  async function saveOffset() {
    if (!current || !status) return;
    const full = await api.song(current.id);
    delete full.lyricsText;
    full.offset = Math.round(((full.offset || 0) + status.offset) * 1000) / 1000;
    await api.save(full);
    await send('offset', { value: 0 });
    await send('load', { id: current.id });
    toast({ title: '已存入歌曲設定', body: `歌詞偏移 ${full.offset.toFixed(2)} 秒`, tone: 'success' });
  }

  function seekTo(e) {
    if (!status?.duration) return;
    const r = e.currentTarget.getBoundingClientRect();
    send('seek', { time: ((e.clientX - r.left) / r.width) * status.duration });
  }

  function onKey(e) {
    if (e.target instanceof HTMLInputElement || e.target instanceof HTMLSelectElement || e.target instanceof HTMLTextAreaElement) return;
    const map = {
      Space: () => send('toggle'),
      ArrowLeft: () => send('seekBy', { delta: -5 }),
      ArrowRight: () => send('seekBy', { delta: 5 }),
      ArrowUp: () => send('volume', { value: Math.min(1, (status?.volume ?? 1) + 0.05) }),
      ArrowDown: () => send('volume', { value: Math.max(0, (status?.volume ?? 1) - 0.05) }),
      BracketLeft: () => send('offset', { delta: -0.05 }),
      BracketRight: () => send('offset', { delta: 0.05 }),
      KeyR: () => send('restart'),
      KeyS: () => send('stop'),
      KeyH: () => send('lyrics'),
      KeyN: () => next(),
    };
    if (map[e.code]) {
      e.preventDefault();
      map[e.code]();
    }
  }

  onMount(() => {
    refresh();
    return listen('control', {
      open: () => (connected = true),
      error: () => (connected = false),
      status: (s) => (status = s),
      clients: (c) => (players = c.player),
    });
  });
</script>

<svelte:window onkeydown={onKey} />

<Nav current="control" />
<div class="wrap">
  <section class="card now">
    <div class="row">
      <StatusLamp state={!connected ? 'off' : players ? (status?.playing ? 'live' : 'ok') : 'warn'} label={!connected ? '伺服器離線' : players ? `播放器 ${players}` : '沒有播放器'} />
      <div class="grow">
        <div class="title">{status?.title ?? '（未載入）'}</div>
        <div class="muted">{status?.artist ?? ''}</div>
      </div>
      <div class="time bb-num">{clock(status?.time)} / {clock(status?.duration)}</div>
    </div>
    <button class="bar" onclick={seekTo} aria-label="跳到">
      <span style:width="{status?.duration ? (status.time / status.duration) * 100 : 0}%"></span>
    </button>
    {#if status?.blocked}<p class="bad">播放器被瀏覽器擋住自動播放：在播放器頁面點一下（OBS 裡不會發生）。</p>{/if}
    {#if status?.error}<p class="bad">{status.error}</p>{/if}
    <div class="row">
      <Button onclick={() => send('toggle')} en="Space">{status?.playing ? '暫停' : '播放'}</Button>
      <Button variant="ink" onclick={() => send('restart')} en="R">從頭</Button>
      <Button variant="ghost" onclick={() => send('seekBy', { delta: -5 })} en="Left">-5 秒</Button>
      <Button variant="ghost" onclick={() => send('seekBy', { delta: 5 })} en="Right">+5 秒</Button>
      <Button variant="ghost" onclick={() => send('stop')} en="S">停止</Button>
      <Button variant="ghost" onclick={() => send('lyrics')} en="H">{status?.showLyrics === false ? '顯示歌詞' : '隱藏歌詞'}</Button>
      <Button variant="accent" onclick={next} en="N">下一首（佇列）</Button>
    </div>
    <div class="row sliders">
      <label class="field">音量 {Math.round((status?.volume ?? 1) * 100)}%
        <input type="range" min="0" max="1" step="0.01" value={status?.volume ?? 1} oninput={(e) => send('volume', { value: e.currentTarget.value })} />
      </label>
      <div class="field">
        <span>歌詞偏移 {(status?.offset ?? 0) >= 0 ? '+' : ''}{(status?.offset ?? 0).toFixed(2)} 秒（<kbd>[</kbd> 提早 <kbd>]</kbd> 延後）</span>
        <div class="row">
          <Button size="sm" variant="ghost" onclick={() => send('offset', { delta: -0.05 })}>-0.05</Button>
          <Button size="sm" variant="ghost" onclick={() => send('offset', { delta: 0.05 })}>+0.05</Button>
          <Button size="sm" variant="ghost" onclick={() => send('offset', { value: 0 })}>歸零</Button>
          <Button size="sm" variant="ink" disabled={!current || !status?.offset} onclick={saveOffset}>存到這首歌</Button>
        </div>
      </div>
      <div class="field grow">
        <span>唱過紀錄（直播標題，可留空）</span>
        <div class="row">
          <input class="grow" type="text" bind:value={streamTitle} placeholder="例如：2026-10-29 歌回" />
          <Button size="sm" variant="ink" disabled={!current} onclick={markSung}>記錄今天唱過</Button>
        </div>
      </div>
    </div>
  </section>

  <div class="cols">
    <section class="card">
      <div class="row head">
        <h2 class="grow">曲庫</h2>
        <input type="search" bind:value={query} placeholder="搜尋歌名、原唱、標籤" />
      </div>
      <table>
        <tbody>
          {#each filtered as s (s.id)}
            <tr class:playing={s.id === status?.songId}>
              <td>
                <b>{s.title}</b>
                <div class="muted">{s.artist}{s.source === 'example' ? '（示範）' : ''}</div>
              </td>
              <td class="muted nowrap">
                {#if !s.hasAudio}<span class="bad">缺伴奏</span>{/if}
                {#if !s.hasLyrics}<span class="bad">缺歌詞</span>{/if}
                {#if s.performances?.length}唱過 {s.performances.length} 次{/if}
              </td>
              <td class="nowrap actions">
                <Button size="sm" onclick={() => cue(s, true)}>播放</Button>
                <Button size="sm" variant="ghost" onclick={() => cue(s)}>載入</Button>
                <Button size="sm" variant="ghost" onclick={() => enqueue(s)}>＋佇列</Button>
              </td>
            </tr>
          {:else}
            <tr><td class="muted">沒有符合的歌</td></tr>
          {/each}
        </tbody>
      </table>
    </section>

    <aside>
      <section class="card">
        <h2>佇列</h2>
        {#if queue.length}
          <ol class="queue">
            {#each queue as id, i}
              {@const s = songs.find((x) => x.id === id)}
              <li>
                <span class="grow">{s?.title ?? id}</span>
                <button class="x" aria-label="往上" disabled={i === 0} onclick={() => (queue = queue.toSpliced(i - 1, 2, queue[i], queue[i - 1]))}>↑</button>
                <button class="x" aria-label="移除" onclick={() => (queue = queue.toSpliced(i, 1))}>✕</button>
              </li>
            {/each}
          </ol>
        {:else}
          <p class="muted">在曲庫按「＋佇列」，直播時按 <kbd>N</kbd> 播下一首。</p>
        {/if}
      </section>

      <section class="card">
        <h2>OBS 播放器</h2>
        <div class="look">
          <label class="field">配色
            <select bind:value={look.theme}>{#each Object.entries(THEMES) as [k, t]}<option value={k}>{t.label}</option>{/each}</select>
          </label>
          <label class="field">字型
            <select bind:value={look.font}>{#each Object.entries(FONTS) as [k, f]}<option value={k}>{f.label}</option>{/each}</select>
          </label>
          <label class="field">字級（畫面高 %）<input type="number" min="3" max="20" step="0.5" bind:value={look.size} /></label>
          <label class="field">離底部（%）<input type="number" min="0" max="60" step="1" bind:value={look.bottom} /></label>
        </div>
        <div class="row">
          <Button size="sm" variant="ink" onclick={() => send('style', look)}>套用到播放器</Button>
          <Button size="sm" variant="ghost" onclick={() => navigator.clipboard.writeText(playerUrl).then(() => toast({ title: '已複製網址', tone: 'success' }))}>複製網址</Button>
        </div>
        <p class="muted url">{playerUrl}</p>
        <p class="muted">OBS：來源 → 瀏覽器，貼上網址，寬 1920、高 1080，勾「透過 OBS 控制音訊」。這個控制台可以加成 OBS 的「自訂瀏覽器停駐視窗」。</p>
      </section>

      <section class="card muted keys">
        <kbd>Space</kbd> 播放／暫停　<kbd>←</kbd><kbd>→</kbd> ±5 秒　<kbd>↑</kbd><kbd>↓</kbd> 音量　<kbd>[</kbd><kbd>]</kbd> 歌詞偏移　<kbd>R</kbd> 從頭　<kbd>S</kbd> 停止　<kbd>H</kbd> 歌詞顯示　<kbd>N</kbd> 下一首
      </section>
    </aside>
  </div>
</div>
<Toaster />

<style>
  .now .title {
    font-size: var(--bb-text-xl);
    font-weight: 700;
  }
  .time {
    font-size: var(--bb-text-xl);
  }
  .bar {
    display: block;
    width: 100%;
    height: 10px;
    margin: var(--bb-space-3) 0;
    padding: 0;
    border: 0;
    background: var(--bb-line);
    cursor: pointer;
  }
  .bar span {
    display: block;
    height: 100%;
    background: var(--bb-blue);
  }
  .sliders {
    margin-top: var(--bb-space-4);
    gap: var(--bb-space-5);
    align-items: flex-start;
  }
  .cols {
    display: grid;
    grid-template-columns: minmax(0, 1fr) 340px;
    gap: var(--bb-space-4);
  }
  @media (max-width: 860px) {
    .cols {
      grid-template-columns: 1fr;
    }
  }
  .head h2 {
    margin: 0;
  }
  tr.playing {
    background: var(--bb-blue-soft);
  }
  .nowrap {
    white-space: nowrap;
  }
  .actions {
    text-align: right;
  }
  .queue {
    margin: 0;
    padding-left: 1.4em;
  }
  .queue li {
    display: flex;
    gap: 6px;
    align-items: center;
    padding: 3px 0;
  }
  .x {
    border: 0;
    background: none;
    color: var(--bb-ink-3);
    cursor: pointer;
  }
  .look {
    display: grid;
    grid-template-columns: 1fr 1fr;
    gap: var(--bb-space-2);
    margin-bottom: var(--bb-space-3);
  }
  .url {
    word-break: break-all;
    font-family: var(--bb-font-mono);
  }
  .keys {
    line-height: 2;
  }
</style>
