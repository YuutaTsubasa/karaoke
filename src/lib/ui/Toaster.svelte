<script>
  import { fly } from 'svelte/transition';
  import { dismiss, toasts } from './toast.svelte.js';
</script>

<div class="toaster" aria-live="polite">
  {#each toasts as t (t.id)}
    <button class="toast {t.tone}" transition:fly={{ x: 40, duration: 200 }} onclick={() => dismiss(t.id)}>
      <b>{t.title}</b>
      {#if t.body}<span>{t.body}</span>{/if}
    </button>
  {/each}
</div>

<style>
  .toaster {
    position: fixed;
    right: 16px;
    bottom: 16px;
    z-index: 100;
    display: flex;
    flex-direction: column;
    gap: 8px;
  }
  .toast {
    display: flex;
    flex-direction: column;
    align-items: flex-start;
    gap: 2px;
    min-width: 220px;
    max-width: 360px;
    padding: 10px 14px;
    font: inherit;
    text-align: left;
    color: var(--ui-ink);
    background: var(--ui-surface);
    border: 2px solid var(--ui-ink);
    border-left: 8px solid var(--ui-ink-3);
    box-shadow: var(--ui-shadow);
    cursor: pointer;
  }
  .success {
    border-left-color: var(--ui-blue);
  }
  .warn {
    border-left-color: var(--ui-yellow);
  }
  span {
    font-size: var(--ui-text-sm);
    color: var(--ui-ink-2);
  }
</style>
