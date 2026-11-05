<script>
  // Practice page: one screen to pick a song and sing along, on a phone, tablet or
  // TV browser. The sound plays on the device that opened the page; nothing here
  // changes the library. The practice server (karaoke -serve -practice) only serves
  // this page.
  import { onMount } from 'svelte';
  import KaraokeStage from '../lib/KaraokeStage.svelte';
  import { api, clock, KEY_RANGE, keyLabel } from '../lib/client.js';
  import { smoothClock } from '../lib/clock.js';
  import { parseLyrics } from '../lib/lyrics.js';
  import { FONTS, stageVars, THEMES } from '../lib/theme.js';
  import { createTransposer } from '../lib/transpose.js';

  // The key shifter is an AudioWorklet, which browsers only allow on https or on
  // this computer itself (not over plain http from another device).
  const canShift = typeof window !== 'undefined' && window.isSecureContext && typeof AudioWorkletNode !== 'undefined';

  let songs = $state([]);
  let query = $state('');
  let listError = $state('');

  let song = $state(null);
  let lyrics = $state(null);
  let time = $state(0);
  let duration = $state(NaN);
  let playing = $state(false);
  let key = $state(0);
  let keyLatency = $state(0);
  let vocals = $state(false); // playing the original recording instead of the instrumental
  let error = $state('');
  let controls = $state(true);
  let fullscreen = $state(false);

  let width = $state(1280);
  let height = $state(720);

  // Look of the lyrics, remembered on this device only.
  const saved = (() => {
    try {
      return JSON.parse(localStorage.getItem('karaoke.practice.look')) || {};
    } catch {
      return {};
    }
  })();
  let font = $state(FONTS[saved.font] ? saved.font : 'rounded');
  let theme = $state(THEMES[saved.theme] ? saved.theme : 'blue');
  let lookOpen = $state(false);
  $effect(() => {
    try {
      localStorage.setItem('karaoke.practice.look', JSON.stringify({ font, theme }));
    } catch {}
  });

  /** @type {HTMLAudioElement} */
  let audio;
  let transposer;
  let pendingKey = 0; // the song's saved key, applied on the first tap (needs a user gesture)
  let hideTimer;
  let wakeLock = null;

  let shown = $derived.by(() => {
    const q = query.trim().toLowerCase();
    if (!q) return songs;
    return songs.filter((s) => `${s.title} ${s.artist ?? ''} ${(s.tags ?? []).join(' ')}`.toLowerCase().includes(q));
  });
  // The original recording may start later than the instrumental (song.reference.offset).
  let refShift = $derived(vocals ? Number(song?.reference?.offset || 0) : 0);
  let lyricTime = $derived(time - refShift - keyLatency - (song?.offset || 0) - (lyrics?.offset || 0));

  // Lyric size from the screen shape: 8% of the height on a 16:9 screen, smaller on
  // a tall phone so a line still fits (long lines wrap), and lifted off the bottom
  // edge in portrait so the controls do not cover them.
  let portrait = $derived(height > width);
  let size = $derived(Math.max(4.2, Math.min(8, 8 * (width / height) / (16 / 9))));
  let bottom = $derived(portrait ? 22 : 9);

  async function loadList() {
    try {
      const list = await api.songs();
      songs = list.filter((s) => s.hasAudio && s.hasLyrics);
    } catch (e) {
      listError = `讀不到歌單：${e.message}`;
    }
  }

  async function open(id) {
    error = '';
    vocals = false;
    try {
      const s = await api.song(id);
      song = s;
      lyrics = s.lyricsText ? parseLyrics(s.lyricsText, s.lyrics) : null;
      time = 0;
      audio.src = s.audioUrl;
      audio.volume = Math.min(1, s.volume ?? 1);
      if (key && canShift) await setKey(0); // sets pendingKey too, so the song's own comes after
      pendingKey = canShift ? s.key || 0 : 0;
      history.pushState({ song: id }, '', `?song=${encodeURIComponent(id)}`);
      poke();
    } catch (e) {
      error = `載入失敗：${e.message}`;
    }
  }

  function back() {
    audio.pause();
    audio.removeAttribute('src');
    song = null;
    lyrics = null;
    if (history.state?.song) history.back();
    else history.replaceState(null, '', location.pathname);
  }

  async function toggle() {
    if (!song) return;
    if (!audio.paused) return audio.pause();
    try {
      const started = audio.play();
      if (pendingKey !== key) setKey(pendingKey); // same tap, so the browser lets audio processing start
      await started;
    } catch (e) {
      error = `無法播放：${e.message}`;
    }
  }

  async function setKey(value) {
    if (!canShift) return;
    try {
      key = await transposer.set(Math.max(-KEY_RANGE, Math.min(KEY_RANGE, value)));
      pendingKey = key;
      keyLatency = Number.isFinite(transposer.latency) ? transposer.latency : 0;
    } catch (e) {
      error = `無法變調：${e.message}`;
    }
  }

  function seek(t) {
    if (!song) return;
    const end = Number.isFinite(audio.duration) ? audio.duration - 0.05 : t;
    audio.currentTime = Math.max(0, Math.min(t, end));
    time = audio.currentTime;
  }

  // Switch between the instrumental and the original recording at the same spot.
  function setVocals(on) {
    if (!song?.referenceAudioUrl || on === vocals) return;
    const shift = Number(song.reference?.offset || 0);
    const at = Math.max(0, audio.currentTime + (on ? shift : -shift));
    const wasPlaying = !audio.paused;
    vocals = on;
    audio.src = on ? song.referenceAudioUrl : song.audioUrl;
    audio.addEventListener(
      'loadedmetadata',
      () => {
        audio.currentTime = at;
        if (wasPlaying) audio.play().catch(() => {});
      },
      { once: true },
    );
  }

  async function toggleFullscreen() {
    try {
      if (document.fullscreenElement) await document.exitFullscreen();
      else await document.documentElement.requestFullscreen();
    } catch {}
  }

  // Controls show on any touch and fade out while singing.
  function poke() {
    controls = true;
    clearTimeout(hideTimer);
    hideTimer = setTimeout(() => {
      if (playing) controls = false;
    }, 3500);
  }

  async function keepAwake(on) {
    try {
      if (on && !wakeLock) wakeLock = await navigator.wakeLock?.request('screen');
      else if (!on && wakeLock) {
        await wakeLock.release();
        wakeLock = null;
      }
    } catch {}
  }

  function onKey(e) {
    if (e.target instanceof HTMLInputElement || !song) return;
    const map = {
      Space: () => toggle(),
      ArrowLeft: () => seek(audio.currentTime - 5),
      ArrowRight: () => seek(audio.currentTime + 5),
      Minus: () => setKey(key - 1),
      Equal: () => setKey(key + 1),
      Escape: () => !document.fullscreenElement && back(),
    };
    if (map[e.code]) {
      e.preventDefault();
      map[e.code]();
      poke();
    }
  }

  onMount(() => {
    transposer = createTransposer(audio);
    const stop = smoothClock(audio, (t) => (time = t));
    loadList();
    const id = new URLSearchParams(location.search).get('song');
    if (id) open(id);
    const onPop = () => {
      if (!history.state?.song && song) {
        audio.pause();
        song = null;
        lyrics = null;
      }
    };
    const onFs = () => (fullscreen = !!document.fullscreenElement);
    addEventListener('popstate', onPop);
    document.addEventListener('fullscreenchange', onFs);
    return () => {
      stop();
      removeEventListener('popstate', onPop);
      document.removeEventListener('fullscreenchange', onFs);
    };
  });
</script>

<svelte:window onkeydown={onKey} bind:innerWidth={width} bind:innerHeight={height} />

<audio
  bind:this={audio}
  preload="auto"
  onplay={() => ((playing = true), poke(), keepAwake(true))}
  onpause={() => ((playing = false), (controls = true), keepAwake(false))}
  onended={() => ((playing = false), (controls = true), keepAwake(false))}
  ondurationchange={() => (duration = audio.duration)}
></audio>

{#if !song}
  <main class="list">
    <header>
      <h1>歌回 練歌</h1>
      <input type="search" placeholder="搜尋歌名、歌手" bind:value={query} />
    </header>
    {#if listError}<p class="note">{listError}</p>{/if}
    {#if error}<p class="note">{error}</p>{/if}
    <ul>
      {#each shown as s (s.id)}
        <li>
          <button onclick={() => open(s.id)}>
            <span class="t">{s.title}</span>
            <span class="a">{s.artist ?? ''}</span>
          </button>
        </li>
      {:else}
        <li class="empty">{songs.length ? '找不到這首歌' : '還沒有歌'}</li>
      {/each}
    </ul>
  </main>
{:else}
  <!-- svelte-ignore a11y_click_events_have_key_events, a11y_no_noninteractive_element_interactions -->
  <main class="sing" class:hide={!controls} onclick={poke} onpointermove={poke}>
    <div class="stage" style={stageVars({ theme, font, size, bottom })}>
      <KaraokeStage {lyrics} time={lyricTime} {song} />
    </div>

    {#if !playing && time < 0.5}
      <button class="big-play" onclick={(e) => (e.stopPropagation(), toggle())} aria-label="開始">▶</button>
    {/if}

    <div class="top bar">
      <button onclick={back}>← 選歌</button>
      <div class="now">
        <b>{song.title}</b>
        {#if song.artist}<span>{song.artist}</span>{/if}
      </div>
      <button onclick={() => (lookOpen = !lookOpen)} class:on={lookOpen}>字型</button>
      <button onclick={toggleFullscreen}>{fullscreen ? '離開全螢幕' : '全螢幕'}</button>
    </div>

    {#if lookOpen && controls}
      <div class="look">
        <div class="group">
          <span>字型</span>
          {#each Object.entries(FONTS) as [id, f] (id)}
            <button class:on={font === id} style="font-family: {f.family}; font-weight: {f.weight}" onclick={() => (font = id)}>
              {f.label.replace(/（.*）/, '')}
            </button>
          {/each}
        </div>
        <div class="group">
          <span>顏色</span>
          {#each Object.entries(THEMES) as [id, t] (id)}
            <button class:on={theme === id} onclick={() => (theme = id)}>
              <i style="background: {t.sungFill}"></i>{t.label.replace(/（.*）/, '')}
            </button>
          {/each}
        </div>
      </div>
    {/if}

    <div class="bottom bar">
      <div class="seek">
        <span class="ui-num">{clock(time)}</span>
        <input type="range" min="0" max={Number.isFinite(duration) ? duration : 0} step="0.1" value={time}
          oninput={(e) => seek(Number(e.currentTarget.value))} aria-label="進度" />
        <span class="ui-num">{clock(duration)}</span>
      </div>
      <div class="buttons">
        <button onclick={() => seek(audio.currentTime - 10)} aria-label="倒退 10 秒">⟲ 10</button>
        <button class="play" onclick={toggle}>{playing ? '❚❚' : '▶'}</button>
        <button onclick={() => seek(audio.currentTime + 10)} aria-label="快轉 10 秒">10 ⟳</button>
        <span class="gap"></span>
        <div class="key" title={canShift ? '' : '用家裡網路從別的裝置打開時，瀏覽器不允許變調'}>
          <button onclick={() => setKey(key - 1)} disabled={!canShift || key <= -KEY_RANGE}>♭</button>
          <span class="ui-num">{canShift ? keyLabel(key) : '原調'}</span>
          <button onclick={() => setKey(key + 1)} disabled={!canShift || key >= KEY_RANGE}>♯</button>
        </div>
        {#if song.referenceAudioUrl}
          <div class="seg">
            <button class:on={!vocals} onclick={() => setVocals(false)}>伴奏</button>
            <button class:on={vocals} onclick={() => setVocals(true)}>原唱</button>
          </div>
        {/if}
      </div>
      {#if error}<p class="note">{error}</p>{/if}
    </div>
  </main>
{/if}

<style>
  :global(html, body) {
    margin: 0;
    height: 100%;
    background: #060b1a;
    color: #eef2fa;
    font-family: var(--ui-font);
    -webkit-tap-highlight-color: transparent;
  }
  button {
    font: inherit;
    color: inherit;
    cursor: pointer;
  }

  /* --- song list --- */
  .list {
    max-width: 900px;
    margin: 0 auto;
    padding: 16px 16px 48px;
  }
  .list header {
    position: sticky;
    top: 0;
    padding: 12px 0;
    background: #060b1a;
    z-index: 1;
  }
  h1 {
    margin: 0 0 12px;
    font-size: 1.5rem;
    border-left: 6px solid var(--ui-yellow);
    padding-left: 10px;
  }
  input[type='search'] {
    width: 100%;
    box-sizing: border-box;
    padding: 12px 14px;
    font: inherit;
    font-size: 1.05rem;
    color: inherit;
    background: #0d1530;
    border: 1px solid rgb(238 242 250 / 0.3);
    border-radius: 3px;
  }
  ul {
    list-style: none;
    margin: 8px 0 0;
    padding: 0;
    display: grid;
    grid-template-columns: repeat(auto-fill, minmax(240px, 1fr));
    gap: 10px;
  }
  li button {
    width: 100%;
    min-height: 76px;
    padding: 12px 14px;
    text-align: left;
    background: #0d1530;
    border: 1px solid rgb(238 242 250 / 0.14);
    border-left: 4px solid var(--ui-blue);
    border-radius: 3px;
    display: flex;
    flex-direction: column;
    gap: 4px;
  }
  li button:hover,
  li button:focus-visible {
    border-left-color: var(--ui-yellow);
    background: #13204a;
  }
  .t {
    font-size: 1.1rem;
    font-weight: 700;
  }
  .a {
    color: #8f9ab0;
    font-size: 0.9rem;
  }
  .empty,
  .note {
    color: #8f9ab0;
  }

  /* --- singing --- */
  .sing {
    position: fixed;
    inset: 0;
    background:
      radial-gradient(ellipse at 30% 20%, #2b3f8f 0%, transparent 60%),
      linear-gradient(160deg, #10183a, #05070c);
    overflow: hidden;
  }
  .sing.hide {
    cursor: none;
  }
  .stage {
    position: absolute;
    inset: 0;
  }
  .bar {
    position: absolute;
    left: 0;
    right: 0;
    padding: 10px max(16px, env(safe-area-inset-left)) 10px max(16px, env(safe-area-inset-right));
    background: rgb(2 4 10 / 0.72);
    transition: opacity 0.3s, transform 0.3s;
  }
  .top {
    top: 0;
    padding-top: max(10px, env(safe-area-inset-top));
    display: flex;
    align-items: center;
    gap: 12px;
  }
  .bottom {
    bottom: 0;
    padding-bottom: max(12px, env(safe-area-inset-bottom));
  }
  .hide .top {
    opacity: 0;
    transform: translateY(-100%);
    pointer-events: none;
  }
  .hide .bottom {
    opacity: 0;
    transform: translateY(100%);
    pointer-events: none;
  }
  .now {
    flex: 1;
    min-width: 0;
    display: flex;
    flex-direction: column;
    overflow: hidden;
  }
  .now b,
  .now span {
    white-space: nowrap;
    overflow: hidden;
    text-overflow: ellipsis;
  }
  .now span {
    color: #8f9ab0;
    font-size: 0.85rem;
  }
  .bar button {
    min-height: 44px;
    min-width: 44px;
    padding: 0 14px;
    background: rgb(238 242 250 / 0.08);
    border: 1px solid rgb(238 242 250 / 0.25);
    border-radius: 3px;
  }
  .bar button:disabled {
    opacity: 0.35;
    cursor: default;
  }
  .seek {
    display: flex;
    align-items: center;
    gap: 10px;
    margin-bottom: 8px;
  }
  .seek input {
    flex: 1;
    accent-color: var(--ui-yellow);
  }
  .buttons {
    display: flex;
    flex-wrap: wrap;
    align-items: center;
    gap: 8px;
  }
  .gap {
    flex: 1;
  }
  .bar .play {
    min-width: 64px;
    background: var(--ui-yellow);
    color: #0b0f1a;
    border-color: var(--ui-yellow);
    font-weight: 700;
  }
  .key,
  .seg {
    display: flex;
    align-items: center;
    gap: 6px;
  }
  .key span {
    min-width: 3.2em;
    text-align: center;
  }
  .seg button.on {
    background: var(--ui-blue);
    border-color: var(--ui-blue);
  }
  .top button.on {
    background: var(--ui-blue);
    border-color: var(--ui-blue);
  }
  .look {
    position: absolute;
    top: calc(max(10px, env(safe-area-inset-top)) + 64px);
    right: 16px;
    left: 16px;
    max-width: 560px;
    margin-left: auto;
    padding: 12px;
    background: rgb(2 4 10 / 0.88);
    border: 1px solid rgb(238 242 250 / 0.2);
    border-radius: 3px;
    display: flex;
    flex-direction: column;
    gap: 10px;
  }
  .look .group {
    display: flex;
    flex-wrap: wrap;
    align-items: center;
    gap: 6px;
  }
  .look .group > span {
    width: 3em;
    color: #8f9ab0;
    font-size: 0.85rem;
  }
  .look button {
    min-height: 40px;
    padding: 0 12px;
    background: rgb(238 242 250 / 0.08);
    border: 1px solid rgb(238 242 250 / 0.25);
    border-radius: 3px;
    display: inline-flex;
    align-items: center;
    gap: 6px;
  }
  .look button.on {
    border-color: var(--ui-yellow);
    box-shadow: inset 0 0 0 1px var(--ui-yellow);
  }
  .look i {
    width: 14px;
    height: 14px;
    border-radius: 2px;
  }
  .big-play {
    position: absolute;
    left: 50%;
    top: 30%;
    transform: translate(-50%, -50%);
    width: 112px;
    height: 112px;
    border-radius: 50%;
    border: 0;
    background: var(--ui-yellow);
    color: #0b0f1a;
    font-size: 48px;
    box-shadow: 0 6px 24px rgb(0 0 0 / 0.5);
  }
</style>
