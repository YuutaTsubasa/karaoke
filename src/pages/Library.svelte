<script>
  // Song library: metadata, instrumental upload, lyrics file, performance history.
  import { onMount } from 'svelte';
  import { Button, ConfirmDialog, Toaster, toast } from 'bluebolt-ui';
  import Nav from '../lib/Nav.svelte';
  import { api, today } from '../lib/client.js';
  import { parseLyrics } from '../lib/lyrics.js';

  let songs = $state([]);
  let query = $state('');
  let sort = $state('title');
  let editing = $state(null); // full song object being edited
  let newTitle = $state('');
  let newArtist = $state('');
  let confirmDelete = $state(false);

  let filtered = $derived.by(() => {
    const q = query.trim().toLowerCase();
    const list = q ? songs.filter((s) => `${s.title} ${s.artist} ${(s.tags || []).join(' ')} ${s.notes || ''}`.toLowerCase().includes(q)) : [...songs];
    const last = (s) => (s.performances || []).map((p) => p.date).sort().at(-1) || '';
    if (sort === 'count') list.sort((a, b) => (b.performances?.length || 0) - (a.performances?.length || 0));
    if (sort === 'recent') list.sort((a, b) => last(b).localeCompare(last(a)));
    if (sort === 'stale') list.sort((a, b) => last(a).localeCompare(last(b)));
    return list;
  });

  async function refresh() {
    songs = await api.songs();
  }

  async function create(e) {
    e.preventDefault();
    if (!newTitle.trim()) return;
    try {
      const s = await api.create({ title: newTitle.trim(), artist: newArtist.trim() });
      newTitle = '';
      newArtist = '';
      await refresh();
      await edit(s.id);
    } catch (err) {
      toast({ title: '新增失敗', body: err.message, tone: 'warn' });
    }
  }

  async function edit(id) {
    const s = await api.song(id);
    s.tagsText = (s.tags || []).join(', ');
    s.performances ||= [];
    editing = s;
  }

  async function save() {
    const s = $state.snapshot(editing);
    s.tags = s.tagsText.split(/[,，、]/).map((t) => t.trim()).filter(Boolean);
    delete s.tagsText;
    delete s.lyricsText;
    s.offset = Number(s.offset) || 0;
    s.volume = Number(s.volume) || 1;
    s.performances = s.performances.filter((p) => p.date);
    try {
      await api.save(s);
      toast({ title: '已儲存', body: s.title, tone: 'success' });
      await refresh();
    } catch (err) {
      toast({ title: '儲存失敗', body: err.message, tone: 'warn' });
    }
  }

  async function uploadAudio(e) {
    const file = e.currentTarget.files?.[0];
    if (!file) return;
    toast({ title: '上傳中…', body: file.name, timeout: 1500 });
    try {
      const s = await api.uploadAudio(editing.id, file);
      editing.audio = s.audio;
      editing.hasAudio = true;
      editing.audioUrl = s.audioUrl;
      toast({ title: '伴奏已上傳', body: file.name, tone: 'success' });
      await refresh();
    } catch (err) {
      toast({ title: '上傳失敗', body: err.message, tone: 'warn' });
    }
  }

  async function uploadLyrics(e) {
    const file = e.currentTarget.files?.[0];
    if (!file) return;
    const text = await file.text();
    const parsed = parseLyrics(text, file.name);
    const name = /\.(ass|ssa)$/i.test(file.name) ? 'lyrics.ass' : 'lyrics.lrc';
    if (!parsed.lines.length && name === 'lyrics.lrc') {
      // plain text: keep it for the timing tool
      await api.saveLyrics(editing.id, text, 'lyrics.txt');
      editing.lyrics = 'lyrics.txt';
      toast({ title: '已存成純文字歌詞', body: '到「歌詞對時」逐字打點', tone: 'success' });
    } else {
      await api.saveLyrics(editing.id, text, name);
      editing.lyrics = name;
      toast({ title: '歌詞已匯入', body: `${parsed.lines.length} 行`, tone: 'success' });
    }
    editing.hasLyrics = true;
    await refresh();
  }

  async function remove() {
    confirmDelete = false;
    await api.remove(editing.id);
    toast({ title: '已移到 library/.trash', body: editing.title });
    editing = null;
    await refresh();
  }

  function last(s) {
    return (s.performances || []).map((p) => p.date).sort().at(-1) || '—';
  }

  onMount(refresh);
</script>

<Nav current="library" />
<div class="wrap">
  <section class="card">
    <form class="row" onsubmit={create}>
      <input class="grow" type="text" bind:value={newTitle} placeholder="歌名" />
      <input class="grow" type="text" bind:value={newArtist} placeholder="原唱" />
      <Button type="submit" disabled={!newTitle.trim()}>新增歌曲</Button>
    </form>
    <p class="muted">伴奏與歌詞存在專案的 <code>library/</code>（不進 Git）。</p>
  </section>

  <section class="card">
    <div class="row head">
      <h2 class="grow">曲庫（{songs.length}）</h2>
      <input type="search" bind:value={query} placeholder="搜尋" />
      <select bind:value={sort}>
        <option value="title">依歌名</option>
        <option value="count">唱最多次</option>
        <option value="recent">最近唱過</option>
        <option value="stale">最久沒唱</option>
      </select>
    </div>
    <table>
      <thead>
        <tr><th>歌名</th><th>原唱</th><th>伴奏</th><th>歌詞</th><th>次數</th><th>最近</th><th></th></tr>
      </thead>
      <tbody>
        {#each filtered as s (s.id)}
          <tr>
            <td><b>{s.title}</b>{#if s.source === 'example'} <span class="muted">（示範）</span>{/if}</td>
            <td>{s.artist}</td>
            <td>{#if s.hasAudio}<span class="ok">✓</span>{:else}<span class="bad">—</span>{/if}</td>
            <td>{#if s.hasLyrics}<span class="ok">✓</span> <span class="muted">{s.lyrics}</span>{:else}<span class="bad">—</span>{/if}</td>
            <td class="bb-num">{s.performances?.length || 0}</td>
            <td class="muted">{last(s)}</td>
            <td class="actions">
              <Button size="sm" variant="ghost" onclick={() => edit(s.id)}>編輯</Button>
              <Button size="sm" variant="ghost" href="/timing.html?song={encodeURIComponent(s.id)}">對時</Button>
              <Button size="sm" variant="ghost" href="/player.html?song={encodeURIComponent(s.id)}&bg=1" target="_blank">預覽</Button>
            </td>
          </tr>
        {/each}
      </tbody>
    </table>
  </section>

  {#if editing}
    <section class="card editor">
      <div class="row head">
        <h2 class="grow">編輯：{editing.title}</h2>
        <Button size="sm" variant="ghost" onclick={() => (editing = null)}>關閉</Button>
      </div>
      <div class="grid">
        <label class="field">歌名<input type="text" bind:value={editing.title} /></label>
        <label class="field">原唱<input type="text" bind:value={editing.artist} /></label>
        <label class="field">作詞<input type="text" bind:value={editing.lyricist} /></label>
        <label class="field">作曲<input type="text" bind:value={editing.composer} /></label>
        <label class="field">標籤（逗號分隔）<input type="text" bind:value={editing.tagsText} /></label>
        <label class="field">歌詞偏移（秒，正數＝歌詞晚一點）<input type="number" step="0.01" bind:value={editing.offset} /></label>
        <label class="field">伴奏音量（0–1）<input type="number" step="0.05" min="0" max="1" bind:value={editing.volume} /></label>
      </div>
      <label class="field">備註<textarea rows="2" bind:value={editing.notes}></textarea></label>

      <div class="grid files">
        <div class="field">
          <span>伴奏音檔 {#if editing.hasAudio}<span class="ok">✓ {editing.audio}</span>{/if}</span>
          <input type="file" accept="audio/*,.mp3,.m4a,.ogg,.opus,.wav,.flac" onchange={uploadAudio} />
          {#if editing.audioUrl && editing.hasAudio}<audio controls src={editing.audioUrl} preload="none"></audio>{/if}
        </div>
        <div class="field">
          <span>歌詞檔（.lrc／.ass／純文字） {#if editing.hasLyrics}<span class="ok">✓ {editing.lyrics}</span>{/if}</span>
          <input type="file" accept=".lrc,.ass,.ssa,.txt" onchange={uploadLyrics} />
          <a href="/timing.html?song={encodeURIComponent(editing.id)}">到歌詞對時工具 →</a>
        </div>
      </div>

      <h3>唱過的場次</h3>
      <table class="perf">
        <thead><tr><th>日期</th><th>直播標題</th><th>網址</th><th></th></tr></thead>
        <tbody>
          {#each editing.performances as p, i}
            <tr>
              <td><input type="date" bind:value={p.date} /></td>
              <td><input class="w" type="text" bind:value={p.title} /></td>
              <td><input class="w" type="url" bind:value={p.url} placeholder="https://youtube.com/…" /></td>
              <td><button class="x" aria-label="刪除" onclick={() => editing.performances.splice(i, 1)}>✕</button></td>
            </tr>
          {/each}
        </tbody>
      </table>
      <div class="row">
        <Button size="sm" variant="ghost" onclick={() => editing.performances.push({ date: today(), title: '', url: '' })}>＋新增場次</Button>
      </div>

      <div class="row footer">
        <Button onclick={save}>儲存</Button>
        <span class="grow"></span>
        {#if editing.source === 'library'}
          <Button variant="ghost" onclick={() => (confirmDelete = true)}>刪除歌曲</Button>
        {/if}
      </div>
    </section>
  {/if}
</div>
<ConfirmDialog
  bind:open={confirmDelete}
  title="刪除這首歌？"
  danger
  message="整個資料夾（含伴奏與歌詞）會移到 library/.trash，可以手動救回。"
  confirmLabel="刪除"
  onconfirm={remove}
/>
<Toaster />

<style>
  .head h2 {
    margin: 0;
  }
  .actions {
    text-align: right;
    white-space: nowrap;
  }
  .grid {
    display: grid;
    grid-template-columns: repeat(auto-fill, minmax(220px, 1fr));
    gap: var(--bb-space-3);
    margin: var(--bb-space-3) 0;
  }
  .files {
    grid-template-columns: repeat(auto-fill, minmax(320px, 1fr));
  }
  .files audio {
    width: 100%;
  }
  .perf input.w {
    width: 100%;
    box-sizing: border-box;
  }
  .x {
    border: 0;
    background: none;
    color: var(--bb-ink-3);
    cursor: pointer;
  }
  .footer {
    margin-top: var(--bb-space-4);
  }
  h3 {
    font-size: var(--bb-text-md);
    margin: var(--bb-space-4) 0 var(--bb-space-2);
  }
</style>
