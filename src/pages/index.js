import '@fontsource-variable/noto-sans-tc/index.css';
import '../lib/ui/tokens.css';
import '../lib/app.css';
import { mount } from 'svelte';
import App from './Library.svelte';

export default mount(App, { target: document.getElementById('app') });
