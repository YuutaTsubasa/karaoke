<script>
  // Button with an optional small key label above the text; <a> when `href` is set.
  let { variant = 'primary', size = 'md', href, type = 'button', disabled = false, en = '', children, ...rest } = $props();
</script>

<svelte:element
  this={href ? 'a' : 'button'}
  class="btn {variant} {size}"
  href={href && !disabled ? href : undefined}
  type={href ? undefined : type}
  disabled={href ? undefined : disabled}
  aria-disabled={disabled || undefined}
  {...rest}
>
  {#if en}<small>{en}</small>{/if}
  <span>{@render children?.()}</span>
</svelte:element>

<style>
  .btn {
    display: inline-flex;
    flex-direction: column;
    align-items: center;
    justify-content: center;
    gap: 1px;
    padding: 6px 14px;
    font: inherit;
    font-weight: 700;
    line-height: 1.2;
    text-decoration: none;
    border: 2px solid var(--ui-ink);
    border-radius: var(--ui-radius);
    cursor: pointer;
    box-shadow: var(--ui-shadow);
    transition:
      transform 80ms,
      box-shadow 80ms;
  }
  .btn:hover:not([disabled]) {
    transform: translate(-1px, -1px);
    box-shadow: 4px 4px 0 var(--ui-ink);
  }
  .btn:active:not([disabled]) {
    transform: translate(2px, 2px);
    box-shadow: 1px 1px 0 var(--ui-ink);
  }
  .btn:focus-visible {
    outline: 3px solid var(--ui-yellow);
    outline-offset: 2px;
  }
  .btn[disabled],
  .btn[aria-disabled] {
    opacity: 0.45;
    cursor: default;
    box-shadow: none;
  }
  .sm {
    padding: 3px 9px;
    font-size: var(--ui-text-sm);
    border-width: 1px;
    box-shadow: none;
  }
  .sm:hover:not([disabled]) {
    box-shadow: 2px 2px 0 var(--ui-ink);
  }
  small {
    font-size: 0.6rem;
    letter-spacing: 0.08em;
    text-transform: uppercase;
    opacity: 0.75;
  }
  .primary {
    background: var(--ui-blue);
    color: var(--ui-on-blue);
  }
  .accent {
    background: var(--ui-yellow);
    color: var(--ui-on-yellow);
  }
  .ink {
    background: var(--ui-ink);
    color: var(--ui-paper);
  }
  .ghost {
    background: var(--ui-surface);
    color: var(--ui-ink);
  }
</style>
