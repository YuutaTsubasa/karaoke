<script>
  // A local recording (the original song, your own guide vocal…) played next to the
  // instrumental as a timing reference. Uploaded into the song folder, and kept in
  // step with the <audio> element: play, pause, seek, speed, with drift correction.
  // `offset` = how many seconds later the song starts in the recording than in the audio.
  import { api } from './client.js';

  /** @type {{ audio: HTMLAudioElement, songId: string, src?: string | null, offset?: number, mix?: string, onuploaded?: (song: any) => void }} */
  let { audio, songId, src = $bindable(null), offset = 0, mix = 'both', onuploaded } = $props();

  let ref = $state();
  let busy = $state(false);
  let error = $state('');

  const target = () => Math.max(0, audio.currentTime + Number(offset || 0));

  function sync(force = false) {
    if (!ref || !src || ref.readyState < 1) return;
    if (force || Math.abs(ref.currentTime - target()) > 0.06) ref.currentTime = target();
  }

  async function upload(e) {
    const file = e.currentTarget.files?.[0];
    if (!file) return;
    busy = true;
    error = '';
    try {
      const song = await fetch(`/api/songs/${encodeURIComponent(songId)}/reference?name=${encodeURIComponent(file.name)}`, {
        method: 'PUT',
        body: file,
      }).then(async (r) => (r.ok ? r.json() : Promise.reject(new Error((await r.json()).error))));
      src = song.referenceAudioUrl;
      onuploaded?.(song);
    } catch (err) {
      error = `上傳失敗：${err.message}`;
    } finally {
      busy = false;
      e.currentTarget.value = '';
    }
  }

  $effect(() => {
    if (!ref) return;
    ref.muted = mix === 'instrumental';
    audio.muted = mix === 'reference';
  });
  $effect(() => {
    offset;
    sync(true);
  });

  $effect(() => {
    if (!audio || !ref) return;
    const on = {
      play: () => {
        sync(true);
        ref.play().catch(() => {});
      },
      pause: () => ref.pause(),
      seeked: () => sync(true),
      ratechange: () => (ref.playbackRate = audio.playbackRate),
    };
    for (const [k, fn] of Object.entries(on)) audio.addEventListener(k, fn);
    ref.playbackRate = audio.playbackRate;
    const timer = setInterval(() => {
      if (!audio.paused) sync();
    }, 400);
    return () => {
      for (const [k, fn] of Object.entries(on)) audio.removeEventListener(k, fn);
      clearInterval(timer);
      ref.pause();
      audio.muted = false;
    };
  });
</script>

<div class="ref">
  <label class="field">
    {src ? '換一個參考音檔' : '選擇參考音檔（原曲、自己唱的錄音…）'}
    <input type="file" accept="audio/*,.mp3,.m4a,.ogg,.opus,.wav,.flac" disabled={busy} onchange={upload} />
  </label>
  {#if busy}<p class="muted">上傳中…</p>{/if}
  {#if error}<p class="bad">{error}</p>{/if}
  {#if src}
    <audio bind:this={ref} {src} preload="auto" onloadedmetadata={() => sync(true)}></audio>
    <p class="muted">已載入：{decodeURIComponent(src.split('/').pop()).replace(/^reference-/, '')}（存在這首歌的資料夾，不會上傳到任何地方）</p>
  {/if}
</div>

<style>
  .ref {
    display: flex;
    flex-direction: column;
    gap: var(--ui-space-2);
  }
  p {
    margin: 0;
  }
</style>
