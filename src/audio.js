export class AudioManager {
  constructor() {
    this.context = null;
    this.master = null;
    this.muted = false;
    this.noiseBuffer = null;
    this.ambient = null;
  }

  ensure() {
    if (this.context) {
      if (this.context.state === 'suspended') this.context.resume();
      return this.context;
    }
    const AudioContext = window.AudioContext || window.webkitAudioContext;
    if (!AudioContext) return null;
    this.context = new AudioContext();
    this.master = this.context.createGain();
    this.master.gain.value = this.muted ? 0 : 0.38;
    const compressor = this.context.createDynamicsCompressor();
    compressor.threshold.value = -18;
    compressor.knee.value = 16;
    compressor.ratio.value = 5;
    compressor.attack.value = 0.003;
    compressor.release.value = 0.22;
    this.master.connect(compressor);
    compressor.connect(this.context.destination);
    this.noiseBuffer = this.createNoiseBuffer(1.2);
    return this.context;
  }

  createNoiseBuffer(seconds) {
    const length = Math.floor(this.context.sampleRate * seconds);
    const buffer = this.context.createBuffer(1, length, this.context.sampleRate);
    const data = buffer.getChannelData(0);
    let last = 0;
    for (let i = 0; i < length; i += 1) {
      const white = Math.random() * 2 - 1;
      last = last * 0.55 + white * 0.45;
      data[i] = last;
    }
    return buffer;
  }

  setMuted(muted) {
    this.muted = muted;
    if (this.master && this.context) {
      this.master.gain.setTargetAtTime(muted ? 0 : 0.38, this.context.currentTime, 0.04);
    }
  }

  tone({
    frequency = 440,
    endFrequency = null,
    duration = 0.12,
    volume = 0.12,
    type = 'sine',
    delay = 0,
    attack = 0.006,
  }) {
    const ctx = this.ensure();
    if (!ctx || this.muted) return;
    const start = ctx.currentTime + delay;
    const oscillator = ctx.createOscillator();
    const gain = ctx.createGain();
    oscillator.type = type;
    oscillator.frequency.setValueAtTime(frequency, start);
    if (endFrequency !== null) {
      oscillator.frequency.exponentialRampToValueAtTime(Math.max(30, endFrequency), start + duration);
    }
    gain.gain.setValueAtTime(0.0001, start);
    gain.gain.exponentialRampToValueAtTime(Math.max(0.001, volume), start + attack);
    gain.gain.exponentialRampToValueAtTime(0.0001, start + duration);
    oscillator.connect(gain);
    gain.connect(this.master);
    oscillator.start(start);
    oscillator.stop(start + duration + 0.03);
  }

  noise({
    duration = 0.15,
    volume = 0.12,
    filterFrequency = 1200,
    filterType = 'lowpass',
    delay = 0,
    q = 0.6,
  }) {
    const ctx = this.ensure();
    if (!ctx || this.muted) return;
    const start = ctx.currentTime + delay;
    const source = ctx.createBufferSource();
    source.buffer = this.noiseBuffer;
    const filter = ctx.createBiquadFilter();
    filter.type = filterType;
    filter.frequency.setValueAtTime(filterFrequency, start);
    filter.frequency.exponentialRampToValueAtTime(Math.max(80, filterFrequency * 0.32), start + duration);
    filter.Q.value = q;
    const gain = ctx.createGain();
    gain.gain.setValueAtTime(volume, start);
    gain.gain.exponentialRampToValueAtTime(0.0001, start + duration);
    source.connect(filter);
    filter.connect(gain);
    gain.connect(this.master);
    source.start(start);
    source.stop(start + duration + 0.02);
  }

  startAmbient() {
    const ctx = this.ensure();
    if (!ctx || this.ambient || this.muted) return;
    const gain = ctx.createGain();
    gain.gain.value = 0.018;
    const filter = ctx.createBiquadFilter();
    filter.type = 'lowpass';
    filter.frequency.value = 420;
    gain.connect(filter);
    filter.connect(this.master);

    const frequencies = [82.41, 123.47, 164.81];
    const oscillators = frequencies.map((frequency, index) => {
      const osc = ctx.createOscillator();
      osc.type = index === 2 ? 'sine' : 'triangle';
      osc.frequency.value = frequency;
      const local = ctx.createGain();
      local.gain.value = index === 2 ? 0.25 : 0.6;
      osc.connect(local);
      local.connect(gain);
      osc.start();
      return osc;
    });
    this.ambient = { gain, oscillators };
  }

  stopAmbient() {
    if (!this.ambient || !this.context) return;
    const { gain, oscillators } = this.ambient;
    gain.gain.setTargetAtTime(0, this.context.currentTime, 0.2);
    for (const oscillator of oscillators) {
      setTimeout(() => oscillator.stop(), 600);
    }
    this.ambient = null;
  }

  shoot() {
    this.noise({ duration: 0.09, volume: 0.18, filterFrequency: 2200, filterType: 'bandpass', q: 0.8 });
    this.tone({ frequency: 190, endFrequency: 72, duration: 0.11, volume: 0.16, type: 'square' });
    this.tone({ frequency: 880, endFrequency: 260, duration: 0.045, volume: 0.025, type: 'sine' });
  }

  empty() {
    this.tone({ frequency: 900, endFrequency: 600, duration: 0.04, volume: 0.035, type: 'square' });
  }

  reloadStart() {
    this.tone({ frequency: 260, endFrequency: 180, duration: 0.06, volume: 0.06, type: 'square' });
  }

  reloadEnd() {
    this.tone({ frequency: 510, endFrequency: 640, duration: 0.055, volume: 0.055, type: 'square' });
    this.tone({ frequency: 760, duration: 0.07, volume: 0.035, type: 'sine', delay: 0.05 });
  }

  hit(headshot = false) {
    this.tone({
      frequency: headshot ? 1180 : 840,
      duration: headshot ? 0.09 : 0.055,
      volume: headshot ? 0.08 : 0.045,
      type: 'sine',
    });
    if (headshot) {
      this.tone({ frequency: 1580, duration: 0.08, volume: 0.04, type: 'sine', delay: 0.035 });
    }
  }

  enemyDown() {
    this.tone({ frequency: 260, endFrequency: 90, duration: 0.22, volume: 0.055, type: 'triangle' });
    this.noise({ duration: 0.18, volume: 0.06, filterFrequency: 640 });
  }

  enemyShoot() {
    this.tone({ frequency: 310, endFrequency: 120, duration: 0.19, volume: 0.045, type: 'sawtooth' });
  }

  playerHurt() {
    this.tone({ frequency: 95, endFrequency: 54, duration: 0.22, volume: 0.12, type: 'sine' });
    this.noise({ duration: 0.12, volume: 0.06, filterFrequency: 340 });
  }

  coreHit() {
    this.tone({ frequency: 150, endFrequency: 62, duration: 0.28, volume: 0.1, type: 'triangle' });
    this.tone({ frequency: 330, endFrequency: 210, duration: 0.2, volume: 0.04, type: 'sine', delay: 0.03 });
  }

  command() {
    this.tone({ frequency: 620, duration: 0.08, volume: 0.04, type: 'sine' });
    this.tone({ frequency: 860, duration: 0.1, volume: 0.035, type: 'sine', delay: 0.07 });
  }

  commandFail() {
    this.tone({ frequency: 230, duration: 0.14, volume: 0.045, type: 'triangle' });
    this.tone({ frequency: 180, duration: 0.16, volume: 0.035, type: 'triangle', delay: 0.1 });
  }

  skill() {
    this.tone({ frequency: 120, endFrequency: 720, duration: 0.45, volume: 0.11, type: 'sine' });
    this.noise({ duration: 0.38, volume: 0.12, filterFrequency: 1800, filterType: 'bandpass', q: 1.4 });
    this.tone({ frequency: 960, endFrequency: 280, duration: 0.35, volume: 0.055, type: 'triangle', delay: 0.1 });
  }

  waveStart() {
    this.tone({ frequency: 196, duration: 0.28, volume: 0.085, type: 'triangle' });
    this.tone({ frequency: 294, duration: 0.32, volume: 0.08, type: 'triangle', delay: 0.25 });
    this.tone({ frequency: 392, duration: 0.5, volume: 0.075, type: 'triangle', delay: 0.52 });
  }

  revive() {
    [392, 494, 587, 784].forEach((frequency, index) => {
      this.tone({ frequency, duration: 0.28, volume: 0.04, type: 'sine', delay: index * 0.08 });
    });
  }

  pickup() {
    this.tone({ frequency: 680, endFrequency: 1080, duration: 0.13, volume: 0.05, type: 'sine' });
  }

  victory() {
    [392, 494, 587, 784, 988].forEach((frequency, index) => {
      this.tone({ frequency, duration: 0.45, volume: 0.075, type: 'triangle', delay: index * 0.13 });
    });
    this.noise({ duration: 1.1, volume: 0.035, filterFrequency: 3400, filterType: 'highpass', delay: 0.3 });
  }

  defeat() {
    [392, 330, 262, 196].forEach((frequency, index) => {
      this.tone({ frequency, duration: 0.55, volume: 0.08, type: 'triangle', delay: index * 0.2 });
    });
  }

  uiClick() {
    this.tone({ frequency: 520, endFrequency: 660, duration: 0.055, volume: 0.03, type: 'sine' });
  }
}
