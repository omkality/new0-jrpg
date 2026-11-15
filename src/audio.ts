// Original temporary sound design. No third-party samples or music.
export class Sound {
  enabled = false;
  private context: AudioContext | null = null;
  private master: GainNode | null = null;
  private ambience: GainNode | null = null;

  async toggle() {
    this.enabled = !this.enabled;
    if (this.enabled) {
      if (!this.context) this.setup();
      await this.context?.resume();
    }
    if (this.master && this.context)
      this.master.gain.setTargetAtTime(
        this.enabled ? 0.16 : 0,
        this.context.currentTime,
        0.15,
      );
    return this.enabled;
  }
  private setup() {
    const context = new AudioContext();
    this.context = context;
    this.master = context.createGain();
    this.master.gain.value = 0;
    this.master.connect(context.destination);
    this.ambience = context.createGain();
    this.ambience.gain.value = 0.13;
    this.ambience.connect(this.master);
    for (const frequency of [55, 82.41, 110.2, 164.81]) {
      const oscillator = context.createOscillator();
      oscillator.type = "sine";
      oscillator.frequency.value = frequency;
      oscillator.connect(this.ambience);
      oscillator.start();
    }
  }
  play(type: "step" | "hit" | "guard" | "pulse" | "secret" | "click" | "win") {
    if (!this.enabled || !this.context || !this.master) return;
    const c = this.context;
    const now = c.currentTime;
    const frequencies =
      type === "pulse"
        ? [110, 165, 220]
        : type === "secret" || type === "win"
          ? [220, 330, 440, 660]
          : [
              type === "hit"
                ? 70
                : type === "guard"
                  ? 440
                  : type === "step"
                    ? 95
                    : 260,
            ];
    frequencies.forEach((frequency, i) => {
      const oscillator = c.createOscillator();
      const gain = c.createGain();
      const start = now + i * 0.07;
      const duration =
        type === "step"
          ? 0.06
          : type === "pulse" || type === "win"
            ? 0.65
            : 0.2;
      oscillator.type = type === "hit" || type === "step" ? "triangle" : "sine";
      oscillator.frequency.setValueAtTime(frequency, start);
      oscillator.frequency.exponentialRampToValueAtTime(
        Math.max(30, frequency * 0.65),
        start + duration,
      );
      gain.gain.setValueAtTime(0, start);
      gain.gain.linearRampToValueAtTime(
        type === "step" ? 0.13 : 0.45 / frequencies.length,
        start + 0.008,
      );
      gain.gain.exponentialRampToValueAtTime(0.001, start + duration);
      oscillator.connect(gain);
      gain.connect(this.master!);
      oscillator.start(start);
      oscillator.stop(start + duration + 0.02);
      oscillator.onended = () => {
        oscillator.disconnect();
        gain.disconnect();
      };
    });
  }
  suspend() {
    void this.context?.suspend();
  }
  resume() {
    if (this.enabled) void this.context?.resume();
  }
}
