// Subtle Web Audio API earcons for non-visual tactile state confirmation
class SoundFeedback {
  private ctx: AudioContext | null = null;
  public enabled: boolean = true;

  private getContext(): AudioContext | null {
    if (!this.enabled || typeof window === 'undefined') return null;
    if (!this.ctx) {
      const AudioCtx =
        window.AudioContext ||
        (window as unknown as { webkitAudioContext: typeof AudioContext }).webkitAudioContext;
      if (AudioCtx) {
        this.ctx = new AudioCtx();
      }
    }
    if (this.ctx && this.ctx.state === 'suspended') {
      this.ctx.resume().catch(() => {});
    }
    return this.ctx;
  }

  // Distinct 3-note ascending chime when "Hey Jarvis" or "Hey Vista" wake word triggers
  playWakeWord() {
    const ctx = this.getContext();
    if (!ctx) return;
    this.playTone(ctx, 523.25, 0, 0.07, 'sine', 0.14); // C5
    this.playTone(ctx, 659.25, 0.07, 0.07, 'sine', 0.15); // E5
    this.playTone(ctx, 783.99, 0.14, 0.12, 'sine', 0.16); // G5
  }

  // Soft ascending double-chime when microphone starts listening
  playListenStart() {
    const ctx = this.getContext();
    if (!ctx) return;
    this.playTone(ctx, 440, 0, 0.08, 'sine', 0.12);
    this.playTone(ctx, 660, 0.09, 0.11, 'sine', 0.14);
  }

  // Tactile shutter click / pulse when capturing camera frame for analysis
  playCapture() {
    const ctx = this.getContext();
    if (!ctx) return;
    this.playTone(ctx, 520, 0, 0.06, 'triangle', 0.14);
    this.playTone(ctx, 580, 0.07, 0.08, 'triangle', 0.12);
  }

  // Warm confirmation chime when AI response arrives
  playSuccess() {
    const ctx = this.getContext();
    if (!ctx) return;
    this.playTone(ctx, 587.33, 0, 0.08, 'sine', 0.12);
    this.playTone(ctx, 880, 0.09, 0.14, 'sine', 0.14);
  }

  // Low two-tone alert when an error or unclear image occurs
  playError() {
    const ctx = this.getContext();
    if (!ctx) return;
    this.playTone(ctx, 300, 0, 0.12, 'sawtooth', 0.08);
    this.playTone(ctx, 220, 0.14, 0.18, 'sawtooth', 0.08);
  }

  private playTone(
    ctx: AudioContext,
    freq: number,
    delay: number,
    duration: number,
    type: OscillatorType,
    gainValue: number
  ) {
    try {
      const osc = ctx.createOscillator();
      const gain = ctx.createGain();
      const startTime = ctx.currentTime + delay;

      osc.type = type;
      osc.frequency.setValueAtTime(freq, startTime);

      gain.gain.setValueAtTime(0.001, startTime);
      gain.gain.exponentialRampToValueAtTime(gainValue, startTime + 0.015);
      gain.gain.exponentialRampToValueAtTime(0.001, startTime + duration);

      osc.connect(gain);
      gain.connect(ctx.destination);

      osc.start(startTime);
      osc.stop(startTime + duration + 0.02);
    } catch {
      // Ignore audio errors on restricted devices
    }
  }
}

export const soundFeedback = new SoundFeedback();
