<script>
  /** @type {{ state?: 'ok' | 'live' | 'warn' | 'off', label?: string }} */
  let { state = 'ok', label = '' } = $props();
</script>

<span class="lamp {state}" role="status"><i></i>{label}</span>

<style>
  .lamp {
    display: inline-flex;
    align-items: center;
    gap: 6px;
    padding: 3px 10px;
    font-size: var(--ui-text-sm);
    font-weight: 700;
    white-space: nowrap;
    border: 1px solid var(--ui-line-2);
    border-radius: 999px;
  }
  i {
    width: 10px;
    height: 10px;
    border-radius: 50%;
    background: #9aa3b5;
  }
  .ok i {
    background: #2fb36a;
  }
  .live i {
    background: #e5322d;
    animation: pulse 1.2s ease-in-out infinite;
  }
  .warn i {
    background: var(--ui-yellow);
  }
  @keyframes pulse {
    50% {
      opacity: 0.35;
    }
  }
  @media (prefers-reduced-motion: reduce) {
    .live i {
      animation: none;
    }
  }
</style>
