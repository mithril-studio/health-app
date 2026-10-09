export type WorkoutCue = "step" | "finish";

// Created/resumed only by a user gesture. No downloaded audio or background alarms.
export class WorkoutAudio {
  private context: AudioContext | null = null;
  constructor(private onReady: (ready: boolean) => void) {}

  async unlock() {
    try {
      this.context ??= new AudioContext();
      const context = this.context;
      context.onstatechange = () => this.onReady(context.state === "running");
      await context.resume();
      this.onReady(context.state === "running");
    } catch {
      this.onReady(false);
    }
  }

  play(cue: WorkoutCue) {
    const context = this.context;
    if (!context || context.state !== "running") {
      this.onReady(false);
      return;
    }
    const notes = cue === "finish" ? [523.25, 659.25, 783.99] : [659.25];
    notes.forEach((frequency, index) => {
      const start = context.currentTime + index * 0.18;
      const oscillator = context.createOscillator();
      const gain = context.createGain();
      oscillator.frequency.value = frequency;
      gain.gain.setValueAtTime(0, start);
      gain.gain.linearRampToValueAtTime(0.12, start + 0.015);
      gain.gain.exponentialRampToValueAtTime(0.001, start + 0.3);
      oscillator.connect(gain);
      gain.connect(context.destination);
      oscillator.onended = () => {
        oscillator.disconnect();
        gain.disconnect();
      };
      oscillator.start(start);
      oscillator.stop(start + 0.32);
    });
  }

  dispose() {
    if (this.context) {
      this.context.onstatechange = null;
      void this.context.close();
      this.context = null;
    }
  }
}
