<script>
  /** @type {{ options: { value: string, label: string }[], value?: string, label?: string, size?: 'sm' | 'md' }} */
  let { options, value = $bindable(options[0]?.value), label = '', size = 'md' } = $props();
</script>

<div class="seg {size}" role="radiogroup" aria-label={label}>
  {#if label}<span class="label">{label}</span>{/if}
  {#each options as o}
    <button type="button" role="radio" aria-checked={value === o.value} class:on={value === o.value} onclick={() => (value = o.value)}>{o.label}</button>
  {/each}
</div>

<style>
  .seg {
    display: inline-flex;
    align-items: center;
  }
  .label {
    margin-right: 6px;
    font-size: var(--ui-text-sm);
    color: var(--ui-ink-3);
  }
  button {
    padding: 4px 10px;
    font: inherit;
    font-size: var(--ui-text-sm);
    color: var(--ui-ink);
    background: var(--ui-surface);
    border: 1px solid var(--ui-line-2);
    cursor: pointer;
  }
  button + button {
    border-left: 0;
  }
  button.on {
    color: var(--ui-on-blue);
    background: var(--ui-blue);
    border-color: var(--ui-blue);
  }
  button:focus-visible {
    outline: 2px solid var(--ui-yellow);
    outline-offset: 1px;
  }
</style>
