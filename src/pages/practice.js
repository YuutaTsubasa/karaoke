import '@fontsource-variable/noto-sans-tc/index.css';
import '../lib/ui/tokens.css';
import { mount } from 'svelte';
import App from './Practice.svelte';

export default mount(App, { target: document.getElementById('app') });
