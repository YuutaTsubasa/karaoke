<script>
  // OBS browser source. Transparent page that plays the instrumental and shows the
  // lyrics. Driven by the control page (server-sent events) or by its own keys
  // (when focused, e.g. OBS "Interact").
  //
  // URL options: song=<id> theme=blue|pink|yellow|classic font=rounded|maru|gothic
  //   size=<% of height> bottom=<% of height> bg=1 (dark preview background)
  //   autoplay=1 (play `song` right away) title=0 (no title card)
  import { onMount } from 'svelte';
  import KaraokeStage from '../lib/KaraokeStage.svelte';
  import { api, listen } from '../lib/client.js';
  import { parseLyrics } from '../lib/lyrics.js';
  import { stageVars } from '../lib/theme.js';

  const params = new URLSearchParams(location.search);
  const opt = (k, d) => params.get(k) ?? d;
  let theme = $state(opt('theme', 'blue'));
  let font = $state(opt('font', 'rounded'));
  let size = $state(Number(opt('size', 0)) || null);
  let bottom = $state(params.has('bottom') ? Number(params.get('bottom')) : null);
  const preview = params.get('bg') === '1';
  const titleCard = params.get('title') !== '0';

  let song = $state(null);
  let lyrics = $state(null);
  let time = $state(0);
  let duration = $state(NaN);
  let playing = $state(false);
  let showLyrics = $state(true);
  let offset = $state(0); // live adjustment on top of song.offset (seconds, + = lyrics later)
  let volume = $state(1);
  let blocked = $state(false);
  let error = $state('');

  /** @type {HTMLAudioElement} */
  let audio;
  let lastPost = 0;

  let lyricTime = $derived(time - (song?.offset || 0) - (lyrics?.offset || 0) - offset);

  async function load(id, { autoplay = false } = {}) {
    error = '';
    try {
      const s = await api.song(id);
      song = s;
      lyrics = s.lyricsText ? parseLyrics(s.lyricsText, s.lyrics) : null;
      offset = 0;
      time = 0;
      audio.src = s.audioUrl || '';
      audio.volume = Math.min(1, (s.volume ?? 1) * volume);
      if (!s.audioUrl) error = '這首歌還沒有伴奏音檔';
      if (autoplay) await play();
      post(true);
    } catch (e) {
      error = `載入失敗：${e.message}`;
    }
  }

  async function play() {
    if (!song) return;
    try {
      await audio.play();
      blocked = false;
    } catch (e) {
      if (e.name === 'NotAllowedError') blocked = true;
      else error = `無法播放：${e.message}`;
    }
  }

  function seek(t) {
    if (!song) return;
    audio.currentTime = Math.max(0, Math.min(t, Number.isFinite(audio.duration) ? audio.duration - 0.05 : t));
    time = audio.currentTime;
  }

  const actions = {
    load: (c) => load(c.id, { autoplay: c.autoplay === true || c.autoplay === '1' }),
    play: () => play(),
    pause: () => audio.pause(),
    toggle: () => (audio.paused ? play() : audio.pause()),
    stop: () => {
      audio.pause();
      seek(0);
    },
    restart: () => {
      seek(0);
      play();
    },
    seek: (c) => seek(Number(c.time)),
    seekBy: (c) => seek(audio.currentTime + Number(c.delta)),
    volume: (c) => {
      volume = Math.max(0, Math.min(1, Number(c.value)));
      audio.volume = Math.min(1, (song?.volume ?? 1) * volume);
    },
    offset: (c) => (offset = c.value != null ? Number(c.value) : offset + Number(c.delta || 0)),
    lyrics: (c) => (showLyrics = c.show == null ? !showLyrics : c.show === true || c.show === '1'),
    style: (c) => {
      if (c.theme) theme = c.theme;
      if (c.font) font = c.font;
      if (c.size) size = Number(c.size);
      if (c.bottom != null) bottom = Number(c.bottom);
    },
    reload: () => location.reload(),
    unload: () => {
      audio.pause();
      audio.removeAttribute('src');
      song = null;
      lyrics = null;
      time = 0;
    },
  };

  function post(force = false) {
    const now = performance.now();
    if (!force && now - lastPost < 400) return;
    lastPost = now;
    api.status({
      songId: song?.id ?? null,
      title: song?.title ?? null,
      artist: song?.artist ?? null,
      time,
      duration,
      playing,
      volume,
      offset,
      showLyrics,
      blocked,
      error,
      theme,
      font,
    });
  }

  function onKey(e) {
    if (e.target instanceof HTMLInputElement) return;
    const map = {
      Space: () => actions.toggle(),
      ArrowLeft: () => actions.seekBy({ delta: -5 }),
      ArrowRight: () => actions.seekBy({ delta: 5 }),
      KeyR: () => actions.restart(),
      KeyH: () => actions.lyrics({}),
      BracketLeft: () => actions.offset({ delta: -0.05 }),
      BracketRight: () => actions.offset({ delta: 0.05 }),
    };
    if (map[e.code]) {
      e.preventDefault();
      map[e.code]();
      post(true);
    }
  }

  onMount(() => {
    // Smooth clock: currentTime only advances in coarse steps in some browsers.
    let raf;
    let base = 0;
    let stamp = 0;
    const tick = () => {
      if (!audio.paused) {
        const ct = audio.currentTime;
        const now = performance.now();
        if (ct !== base) {
          base = ct;
          stamp = now;
        }
        time = Math.max(time, base + Math.min(0.25, (now - stamp) / 1000) * audio.playbackRate);
        if (Math.abs(time - ct) > 0.3) time = ct;
      } else {
        time = audio.currentTime;
        base = time;
      }
      post();
      raf = requestAnimationFrame(tick);
    };
    raf = requestAnimationFrame(tick);
    const off = listen('player', {
      command: (c) => {
        actions[c.action]?.(c);
        post(true);
      },
      open: () => post(true),
    });
    if (params.get('song')) load(params.get('song'), { autoplay: params.get('autoplay') === '1' });
    return () => {
      cancelAnimationFrame(raf);
      off();
    };
  });
</script>

<svelte:window onkeydown={onKey} />

<audio
  bind:this={audio}
  preload="auto"
  onplay={() => ((playing = true), post(true))}
  onpause={() => ((playing = false), post(true))}
  onended={() => ((playing = false), post(true))}
  ondurationchange={() => (duration = audio.duration)}
  onseeked={() => (time = audio.currentTime)}
></audio>

<main class:preview style={stageVars({ theme, font, size, bottom })}>
  <KaraokeStage {lyrics} time={lyricTime} {song} {showLyrics} {titleCard} />
  {#if blocked}
    <button class="unlock" onclick={play}>按一下開始播放（瀏覽器擋住了自動播放；OBS 裡不會出現）</button>
  {/if}
  {#if error && preview}
    <div class="error">{error}</div>
  {/if}
</main>

<style>
  :global(html, body) {
    margin: 0;
    height: 100%;
    background: transparent;
    overflow: hidden;
  }
  main {
    position: fixed;
    inset: 0;
  }
  main.preview {
    background:
      radial-gradient(ellipse at 30% 20%, #2b3f8f 0%, transparent 60%),
      linear-gradient(160deg, #10183a, #05070c);
  }
  .unlock {
    position: absolute;
    top: 2rem;
    left: 50%;
    transform: translateX(-50%);
    padding: 0.8rem 1.4rem;
    font: 600 1rem system-ui, sans-serif;
    border: 0;
    background: #ffd21f;
    color: #0b0f1a;
    cursor: pointer;
  }
  .error {
    position: absolute;
    top: 1rem;
    left: 1rem;
    padding: 0.4rem 0.8rem;
    background: rgb(0 0 0 / 0.7);
    color: #fff;
    font: 14px system-ui, sans-serif;
  }
</style>
