<script>
  let { current } = $props();
  const pages = [
    { href: '/', id: 'library', label: '曲庫' },
    { href: '/control.html', id: 'control', label: '控制台' },
    { href: '/timing.html', id: 'timing', label: '歌詞對時' },
  ];
</script>

<nav>
  <span class="brand">歌回 <b>KARAOKE</b></span>
  {#each pages as p}
    <a href={p.href} class:current={p.id === current}>{p.label}</a>
  {/each}
</nav>

<style>
  nav {
    display: flex;
    gap: var(--bb-space-4);
    align-items: center;
    padding: 10px var(--bb-space-4);
    background: var(--bb-strip);
    color: var(--bb-on-strip);
  }
  .brand {
    font-weight: 700;
    margin-right: var(--bb-space-4);
  }
  .brand b {
    font-family: var(--bb-font-display);
    font-weight: 400;
    letter-spacing: 0.04em;
    color: var(--bb-yellow);
  }
  a {
    color: inherit;
    text-decoration: none;
    padding: 2px 0;
    border-bottom: 2px solid transparent;
  }
  a.current {
    border-color: var(--bb-yellow);
  }
</style>
