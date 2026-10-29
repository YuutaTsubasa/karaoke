<script>
  import Button from './Button.svelte';

  let { open = $bindable(false), title, message = '', danger = false, confirmLabel = '確定', cancelLabel = '取消', onconfirm } = $props();
  let dialog = $state();

  $effect(() => {
    if (!dialog) return;
    if (open && !dialog.open) dialog.showModal();
    if (!open && dialog.open) dialog.close();
  });
</script>

<dialog bind:this={dialog} onclose={() => (open = false)}>
  <h2>{title}</h2>
  {#if message}<p>{message}</p>{/if}
  <div class="actions">
    <Button variant="ghost" onclick={() => (open = false)}>{cancelLabel}</Button>
    <Button variant={danger ? 'accent' : 'primary'} onclick={() => onconfirm?.()}>{confirmLabel}</Button>
  </div>
</dialog>

<style>
  dialog {
    max-width: 420px;
    padding: 20px 24px;
    color: var(--ui-ink);
    background: var(--ui-surface);
    border: 2px solid var(--ui-ink);
    box-shadow: 6px 6px 0 var(--ui-ink);
  }
  dialog::backdrop {
    background: rgb(0 0 0 / 0.45);
  }
  h2 {
    margin: 0 0 8px;
    font-size: var(--ui-text-lg);
  }
  .actions {
    display: flex;
    justify-content: flex-end;
    gap: 8px;
    margin-top: 16px;
  }
</style>
