<script>
  // Two-row karaoke stage (JOYSOUND style): top row left-aligned, bottom row
  // right-aligned, lines alternate between rows. Sized with container units, so it
  // fills whatever box it is put in (the OBS page, or a preview panel).
  import { fade, fly } from 'svelte/transition';
  import KaraokeLine from './KaraokeLine.svelte';
  import { schedule, wrapLines } from './schedule.js';

  /**
   * @type {{
   *   lyrics: import('./lyrics.js').Lyrics | null,
   *   time: number,
   *   song?: { title?: string, artist?: string, lyricist?: string, composer?: string } | null,
   *   showLyrics?: boolean,
   *   titleCard?: boolean,
   *   wrap?: boolean,
   * }}
   */
  let { lyrics, time, song = null, showLyrics = true, titleCard = true, wrap = true } = $props();

  // how many em of lyric text fit in a row; longer lines are split in two
  let rowEl = $state();
  let rowWidth = $state(0);
  let rowHeight = $state(0); // follows the font size (a row is 1.85em tall)
  let maxEm = $derived.by(() => {
    if (!wrap || !rowEl || !rowWidth || !rowHeight) return 0;
    const px = parseFloat(getComputedStyle(rowEl).fontSize);
    return px ? (rowWidth / px) * 0.94 : 0;
  });
  let lines = $derived(wrapLines(lyrics?.lines ?? [], maxEm));
  let plan = $derived(schedule(lines));

  let visible = $derived.by(() => {
    const out = [[], []];
    if (!showLyrics) return out;
    plan.forEach((p, i) => {
      if (time >= p.show && time < p.hide) out[p.row].push(i);
    });
    return out;
  });

  let firstShow = $derived(plan.length ? plan[0].show : Infinity);
  let showTitle = $derived(titleCard && !!song?.title && time < Math.min(firstShow - 0.3, 7));

  function countdownFor(i) {
    const p = plan[i];
    if (p.countdown == null || time < p.countdown || time >= lines[i].start) return null;
    return (lines[i].start - time) / (lines[i].start - p.countdown);
  }
</script>

<div class="stage">
  {#if showTitle}
    <div class="title" transition:fade={{ duration: 400 }}>
      <div class="name">{song.title}</div>
      <div class="credits">
        {#if song.artist}<span>歌　{song.artist}</span>{/if}
        {#if song.lyricist}<span>作詞　{song.lyricist}</span>{/if}
        {#if song.composer}<span>作曲　{song.composer}</span>{/if}
      </div>
    </div>
  {/if}
  <div class="rows">
    <div class="row row0" bind:this={rowEl} bind:clientWidth={rowWidth} bind:clientHeight={rowHeight}>{@render rowLines(0)}</div>
    <div class="row row1">{@render rowLines(1)}</div>
  </div>
</div>

{#snippet rowLines(row)}
  {#each visible[row] as i (i)}
    <div class="slot" in:fly={{ y: 12, duration: 220 }} out:fade={{ duration: 180 }}>
      <KaraokeLine line={lines[i]} {time} align={row === 0 ? 'left' : 'right'} countdown={countdownFor(i)} />
    </div>
  {/each}
{/snippet}

<style>
  .stage {
    position: absolute;
    inset: 0;
    container-type: size;
    overflow: hidden;
    pointer-events: none;
    font-family: var(--k-font);
    font-weight: var(--k-weight, 800);
    font-feature-settings: 'palt' 0;
  }
  .rows {
    position: absolute;
    left: var(--k-margin-x, 6cqw);
    right: var(--k-margin-x, 6cqw);
    bottom: var(--k-bottom, 6cqh);
    font-size: var(--k-size, 8cqh);
  }
  .row {
    position: relative;
    height: 1.85em;
  }
  .row0 {
    margin-right: var(--k-indent, 8cqw);
  }
  .row1 {
    margin-left: var(--k-indent, 8cqw);
  }
  .slot {
    position: absolute;
    inset: 0;
  }

  .title {
    position: absolute;
    left: 0;
    right: 0;
    bottom: calc(var(--k-bottom, 6cqh) + 4.4 * var(--k-size, 8cqh));
    text-align: center;
    color: var(--k-fill);
  }
  .title .name {
    display: inline-block;
    font-size: calc(var(--k-size, 8cqh) * 1.05);
    padding: 0.15em 0.8em;
    color: var(--k-fill);
    text-shadow: var(--k-ring-stroke);
    filter: drop-shadow(0 0.04em 0.06em rgb(0 0 0 / 0.55));
  }
  .title .credits {
    margin-top: 0.5em;
    display: flex;
    justify-content: center;
    gap: 1.6em;
    font-size: calc(var(--k-size, 8cqh) * 0.42);
    color: var(--k-fill);
    text-shadow: var(--k-ring-thin);
  }
</style>
