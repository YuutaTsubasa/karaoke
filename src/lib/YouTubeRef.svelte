<script>
  // A YouTube video (the original song, a karaoke video…) played next to the
  // instrumental as a timing reference, through YouTube's official embed player.
  // It follows the <audio> element: play, pause, seek and speed, and corrects drift.
  // `offset` = how many seconds later the song starts in the video than in the audio.

  /** @type {{ audio: HTMLAudioElement, url?: string, offset?: number, mix?: 'both' | 'reference' | 'instrumental' }} */
  let { audio, url = $bindable(''), offset = 0, mix = 'both' } = $props();

  let host = $state();
  let player = null;
  let ready = $state(false);
  let error = $state('');
  let videoId = $derived(parseId(url));

  function parseId(u) {
    try {
      const x = new URL(String(u).trim());
      if (x.hostname.endsWith('youtu.be')) return x.pathname.slice(1) || null;
      if (!/(^|\.)youtube\.com$/.test(x.hostname)) return null;
      return x.searchParams.get('v') || x.pathname.match(/\/(embed|shorts|live)\/([^/?]+)/)?.[2] || null;
    } catch {
      return null;
    }
  }

  let apiPromise;
  function loadApi() {
    if (window.YT?.Player) return Promise.resolve(window.YT);
    apiPromise ??= new Promise((resolve) => {
      const prev = window.onYouTubeIframeAPIReady;
      window.onYouTubeIframeAPIReady = () => {
        prev?.();
        resolve(window.YT);
      };
      const s = document.createElement('script');
      s.src = 'https://www.youtube.com/iframe_api';
      document.head.append(s);
    });
    return apiPromise;
  }

  const target = () => Math.max(0, audio.currentTime + Number(offset || 0));

  function sync(force = false) {
    if (!player || !ready) return;
    const diff = player.getCurrentTime() - target();
    if (force || Math.abs(diff) > 0.25) player.seekTo(target(), true);
  }

  // create / switch the video
  $effect(() => {
    const id = videoId;
    if (!host || !id) return;
    error = '';
    let cancelled = false;
    loadApi().then((YT) => {
      if (cancelled) return;
      player?.destroy?.();
      player = null;
      ready = false;
      const el = document.createElement('div');
      host.replaceChildren(el);
      player = new YT.Player(el, {
        videoId: id,
        width: '100%',
        height: '100%',
        playerVars: { playsinline: 1, rel: 0, origin: location.origin },
        events: {
          onReady: () => {
            ready = true;
            applyMix();
            player.setPlaybackRate(audio.playbackRate);
            sync(true);
            if (!audio.paused) player.playVideo();
          },
          onError: (e) => (error = e.data === 101 || e.data === 150 ? `上傳者關閉了這部影片的嵌入播放（YouTube 錯誤 ${e.data}），換一部影片試試` : `YouTube 錯誤 ${e.data}`),
        },
      });
    });
    return () => (cancelled = true);
  });

  function applyMix() {
    if (!audio) return;
    audio.muted = mix === 'reference';
    if (!player || !ready) return;
    if (mix === 'instrumental') player.mute();
    else player.unMute();
  }
  $effect(() => {
    mix;
    applyMix();
  });
  $effect(() => {
    offset;
    sync(true);
  });

  // follow the audio element
  $effect(() => {
    if (!audio) return;
    const on = {
      play: () => {
        sync(true);
        player?.playVideo?.();
      },
      pause: () => player?.pauseVideo?.(),
      seeked: () => sync(true),
      ratechange: () => player?.setPlaybackRate?.(audio.playbackRate),
    };
    for (const [k, fn] of Object.entries(on)) audio.addEventListener(k, fn);
    const timer = setInterval(() => {
      if (!audio.paused) sync();
    }, 500);
    return () => {
      for (const [k, fn] of Object.entries(on)) audio.removeEventListener(k, fn);
      clearInterval(timer);
      audio.muted = false;
    };
  });

  $effect(() => () => player?.destroy?.());
</script>

<div class="ref">
  <div class="row">
    <input class="grow" type="url" placeholder="參考影片：貼 YouTube 網址（原曲、ニコカラ…）" bind:value={url} />
  </div>
  {#if videoId}
    <div class="video" bind:this={host}></div>
    {#if error}<p class="bad">{error}</p>{/if}
  {:else if url}
    <p class="bad">看不懂這個網址，請貼 YouTube 影片網址。</p>
  {/if}
</div>

<style>
  .ref {
    display: flex;
    flex-direction: column;
    gap: var(--ui-space-2);
  }
  .video {
    aspect-ratio: 16 / 9;
    background: #000;
  }
  .video :global(iframe) {
    width: 100%;
    height: 100%;
    border: 0;
    display: block;
  }
  p {
    margin: 0;
  }
</style>
