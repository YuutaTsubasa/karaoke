<script>
  // One lyric line: a base layer (unsung colours) with a clipped copy on top
  // (sung colours) whose right edge follows the current syllable.
  import { syllableProgress } from './lyrics.js';

  /** @type {{ line: import('./lyrics.js').Line, time: number, align?: 'left' | 'right', countdown?: number | null }} */
  let { line, time, align = 'left', countdown = null } = $props();

  let host = $state();
  let fill = $state();
  let boxes = $state([]); // [{ left, width }] per syllable
  let natural = $state(0);
  let scale = $state(1);

  function measure() {
    if (!fill || !host) return;
    const spans = fill.querySelectorAll(':scope > .syl');
    boxes = [...spans].map((s) => ({ left: s.offsetLeft, width: s.offsetWidth }));
    natural = fill.offsetWidth;
    const avail = host.parentElement?.clientWidth || natural;
    scale = natural > avail ? avail / natural : 1;
  }

  $effect(() => {
    line;
    const raf = requestAnimationFrame(measure);
    const ro = new ResizeObserver(measure);
    if (host?.parentElement) ro.observe(host.parentElement);
    const fonts = document.fonts;
    fonts?.addEventListener?.('loadingdone', measure);
    fonts?.ready.then(measure);
    return () => {
      cancelAnimationFrame(raf);
      ro.disconnect();
      fonts?.removeEventListener?.('loadingdone', measure);
    };
  });

  let wipe = $derived.by(() => {
    const syl = line.syllables;
    if (!boxes.length || time < syl[0].start) return 0;
    let w = 0;
    for (let i = 0; i < syl.length; i++) {
      const s = syl[i];
      const b = boxes[i];
      if (!b) break;
      if (time < s.start) break;
      w = b.left + b.width * syllableProgress(s, time);
    }
    return w;
  });

  let clip = $derived(wipe <= 0 ? 'inset(0 100% 0 0)' : `inset(-1em ${Math.max(0, natural - wipe)}px -1em -1em)`);
  let dots = $derived(countdown == null ? 0 : Math.max(0, Math.min(4, Math.ceil(countdown * 4))));
</script>

{#snippet text()}{#each line.syllables as s}<span class="syl">{#each s.parts as p}{#if p.ruby}<ruby>{p.base}<rt>{p.ruby}</rt></ruby>{:else}{p.base}{/if}{/each}</span>{/each}{/snippet}

<div class="kline {align}" bind:this={host} style:transform={scale !== 1 ? `scale(${scale})` : null}>
  {#if dots}
    <div class="dots" aria-hidden="true">{#each Array(dots) as _}<i></i>{/each}</div>
  {/if}
  <div class="layer base">
    <div class="copy stroke" aria-hidden="true">{@render text()}</div>
    <div class="copy fill" bind:this={fill}>{@render text()}</div>
  </div>
  <div class="layer sung" style:clip-path={clip} aria-hidden="true">
    <div class="copy stroke">{@render text()}</div>
    <div class="copy fill">{@render text()}</div>
  </div>
</div>

<style>
  .kline {
    position: absolute;
    bottom: 0;
    line-height: 1.15;
    padding-top: 0.55em; /* room for ruby */
  }
  .kline.left {
    left: 0;
    transform-origin: left bottom;
  }
  .kline.right {
    right: 0;
    transform-origin: right bottom;
  }
  .layer {
    position: relative;
  }
  .layer.sung {
    position: absolute;
    left: 0;
    bottom: 0;
  }
  .copy {
    display: inline-block;
    white-space: pre;
    position: relative;
  }
  .copy.stroke {
    position: absolute;
    left: 0;
    bottom: 0;
  }
  .syl {
    position: relative;
  }
  ruby {
    ruby-position: over;
    ruby-align: center;
  }
  rt {
    font-size: 0.46em;
    line-height: 1;
    padding-bottom: 0.08em;
  }

  /* unsung */
  .base .stroke {
    color: var(--k-stroke);
    text-shadow: var(--k-ring-stroke);
    filter: drop-shadow(0 0.04em 0.06em rgb(0 0 0 / 0.55));
  }
  .base .fill {
    color: var(--k-fill);
  }
  /* sung */
  .sung .stroke {
    color: var(--k-sung-stroke);
    text-shadow: var(--k-ring-sung);
  }
  .sung .fill {
    background: var(--k-sung-fill);
    -webkit-background-clip: text;
    background-clip: text;
    color: transparent;
  }
  .sung .fill rt {
    -webkit-text-fill-color: var(--k-sung-ruby, var(--k-sung-solid));
  }

  .dots {
    position: absolute;
    left: 0.1em;
    top: -0.1em;
    display: flex;
    gap: 0.18em;
  }
  .dots i {
    width: 0.34em;
    height: 0.34em;
    border-radius: 50%;
    background: var(--k-sung-solid);
    box-shadow:
      0 0 0 0.06em var(--k-sung-stroke),
      0 0.03em 0.1em rgb(0 0 0 / 0.5);
  }
</style>
