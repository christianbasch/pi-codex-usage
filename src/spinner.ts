const FRAMES = ['⠋', '⠙', '⠹', '⠸', '⠼', '⠴', '⠦', '⠧', '⠇', '⠏'];
const INTERVAL_MS = 80;

export class Spinner {
  private frameIndex = 0;
  private interval: ReturnType<typeof setInterval> | undefined;
  private onTick: (() => void) | undefined;

  get current(): string {
    return FRAMES[this.frameIndex] ?? FRAMES[0]!;
  }

  reset(): void {
    this.frameIndex = 0;
  }

  start(onTick: () => void): void {
    this.onTick = onTick;
    if (this.interval !== undefined) return;
    this.interval = setInterval(() => {
      this.frameIndex = (this.frameIndex + 1) % FRAMES.length;
      this.onTick?.();
    }, INTERVAL_MS);
  }

  stop(): void {
    if (this.interval !== undefined) {
      clearInterval(this.interval);
      this.interval = undefined;
    }
    this.onTick = undefined;
  }
}
