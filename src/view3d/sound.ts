/**
 * Minecraft-ish sound effects synthesised with WebAudio (no audio files): placing and breaking,
 * footsteps, landing, doors and switches. Silent until the first user gesture creates the audio
 * context, and whenever `enabled()` is false. Safe in environments without WebAudio.
 */
type Ctx = AudioContext;

export class SoundFx {
  private ac: Ctx | null = null;
  private noise: AudioBuffer | null = null;
  private stepAlt = false;

  constructor(private readonly enabled: () => boolean) {}

  /** Create / resume the audio context; call from a user gesture (click, key). */
  unlock(): void {
    if (!this.enabled()) return;
    try {
      const AC = (globalThis as { AudioContext?: typeof AudioContext }).AudioContext;
      if (!AC) return;
      this.ac ??= new AC();
      if (this.ac.state === 'suspended') void this.ac.resume();
    } catch {
      this.ac = null;
    }
  }

  private ready(): Ctx | null {
    if (!this.enabled() || !this.ac || this.ac.state !== 'running') return null;
    return this.ac;
  }

  private noiseBuffer(ac: Ctx): AudioBuffer {
    if (!this.noise) {
      const len = Math.floor(ac.sampleRate * 0.5);
      this.noise = ac.createBuffer(1, len, ac.sampleRate);
      const d = this.noise.getChannelData(0);
      for (let i = 0; i < len; i++) d[i] = Math.random() * 2 - 1;
    }
    return this.noise;
  }

  /** Filtered noise burst. */
  private burst(freq: number, q: number, dur: number, gain: number, type: BiquadFilterType = 'bandpass', delay = 0): void {
    const ac = this.ready();
    if (!ac) return;
    const t = ac.currentTime + delay;
    const src = ac.createBufferSource();
    src.buffer = this.noiseBuffer(ac);
    const f = ac.createBiquadFilter();
    f.type = type;
    f.frequency.value = freq;
    f.Q.value = q;
    const g = ac.createGain();
    g.gain.setValueAtTime(gain, t);
    g.gain.exponentialRampToValueAtTime(0.0001, t + dur);
    src.connect(f).connect(g).connect(ac.destination);
    src.start(t, Math.random() * 0.3);
    src.stop(t + dur + 0.02);
  }

  /** Short pitched blip (clicks, thuds). */
  private tone(freq: number, dur: number, gain: number, type: OscillatorType = 'sine', slideTo?: number, delay = 0): void {
    const ac = this.ready();
    if (!ac) return;
    const t = ac.currentTime + delay;
    const o = ac.createOscillator();
    o.type = type;
    o.frequency.setValueAtTime(freq, t);
    if (slideTo) o.frequency.exponentialRampToValueAtTime(slideTo, t + dur);
    const g = ac.createGain();
    g.gain.setValueAtTime(gain, t);
    g.gain.exponentialRampToValueAtTime(0.0001, t + dur);
    o.connect(g).connect(ac.destination);
    o.start(t);
    o.stop(t + dur + 0.02);
  }

  place(): void {
    this.burst(900, 1.2, 0.09, 0.35);
    this.tone(180, 0.08, 0.25, 'triangle', 110);
  }

  break(): void {
    this.burst(1800, 0.8, 0.18, 0.4);
    this.burst(600, 1, 0.12, 0.25, 'bandpass', 0.03);
  }

  step(): void {
    this.stepAlt = !this.stepAlt;
    this.burst(this.stepAlt ? 420 : 360, 1.5, 0.07, 0.12, 'lowpass');
  }

  land(speed: number): void {
    const k = Math.min(1, speed / 14);
    this.burst(220, 0.9, 0.16, 0.18 + 0.3 * k, 'lowpass');
    this.tone(90, 0.12, 0.2 * k, 'sine', 50);
  }

  door(open: boolean): void {
    this.tone(open ? 260 : 200, 0.18, 0.12, 'triangle', open ? 170 : 140);
    this.burst(open ? 700 : 500, 2, 0.14, 0.12, 'bandpass', 0.02);
    if (!open) this.tone(120, 0.08, 0.25, 'square', 80, 0.16);
  }

  click(): void {
    this.tone(1400, 0.03, 0.15, 'square');
    this.tone(900, 0.03, 0.1, 'square', undefined, 0.04);
  }

  dispose(): void {
    void this.ac?.close().catch(() => undefined);
    this.ac = null;
  }
}
