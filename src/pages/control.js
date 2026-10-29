import 'bluebolt-ui/styles.css';
import '../lib/app.css';
import { mount } from 'svelte';
import App from './Control.svelte';

export default mount(App, { target: document.getElementById('app') });
