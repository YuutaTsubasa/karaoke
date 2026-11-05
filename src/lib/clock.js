// Smooth playback clock for an <audio> element: currentTime only advances in
// coarse steps in some browsers, so between steps extrapolate with the wall clock.

/**
 * Calls onTick(time) every animation frame. Returns a stop function.
 * @param {HTMLAudioElement} audio
 * @param {(t: number) => void} onTick
 */
export function smoothClock(audio, onTick) {
  let raf;
  let time = 0;
  let base = 0;
  let stamp = 0;
  const tick = () => {
    if (!audio.paused) {
      const ct = audio.currentTime;
      const now = performance.now();
      if (ct !== base) {
        base = ct;
        stamp = now;
      }
      time = Math.max(time, base + Math.min(0.25, (now - stamp) / 1000) * audio.playbackRate);
      if (Math.abs(time - ct) > 0.3) time = ct;
    } else {
      time = audio.currentTime;
      base = time;
    }
    onTick(time);
    raf = requestAnimationFrame(tick);
  };
  raf = requestAnimationFrame(tick);
  return () => cancelAnimationFrame(raf);
}
