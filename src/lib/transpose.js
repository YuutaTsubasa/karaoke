// Key change for the instrumental: the <audio> element is routed through
// Signalsmith Stretch (MIT; WASM AudioWorklet, live-input mode), which shifts the
// pitch without changing the tempo. At ±0 the shifter is bypassed. Shifting adds a
// little latency, which the player subtracts from the lyric clock.
import SignalsmithStretch from 'signalsmith-stretch';
import { KEY_RANGE } from './client.js';

/** @param {HTMLAudioElement} audio */
export function createTransposer(audio) {
  /** @type {AudioContext | null} */
  let ctx = null;
  let source = null;
  let shifter = null;
  let semitones = 0;
  let shifterLatency = 0;
  let starting = null;

  async function start() {
    const c = new AudioContext();
    // Once the element is captured, it only sounds through the context: make sure
    // the browser lets the context run first, or the song would go silent.
    await Promise.race([c.resume(), new Promise((r) => setTimeout(r, 1500))]);
    if (c.state !== 'running') {
      c.close();
      throw new Error('瀏覽器不允許這個頁面處理音訊（在播放器頁面點一下再試；OBS 裡不會有這個問題）');
    }
    shifter = await SignalsmithStretch(c);
    // a call into the worklet, so it answers with a promise
    shifterLatency = Number(await shifter.latency()) || 0;
    source = c.createMediaElementSource(audio);
    source.connect(c.destination);
    ctx = c;
  }

  return {
    get semitones() {
      return semitones;
    },
    /** Seconds the shifted audio lags behind audio.currentTime. */
    get latency() {
      return semitones ? shifterLatency : 0;
    },
    /** @param {number} value */
    async set(value) {
      const next = Math.max(-KEY_RANGE, Math.min(KEY_RANGE, Math.round(value)));
      if (next === semitones) return semitones;
      if (!ctx) await (starting ??= start().finally(() => (starting = null)));
      if (next && !semitones) {
        source.disconnect();
        source.connect(shifter);
        shifter.connect(ctx.destination);
        shifter.start();
      } else if (!next && semitones) {
        source.disconnect();
        shifter.disconnect();
        shifter.stop();
        source.connect(ctx.destination);
      }
      if (next) shifter.schedule({ semitones: next });
      semitones = next;
      return semitones;
    },
  };
}
