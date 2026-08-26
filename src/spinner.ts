const FRAMES = ['⠋', '⠙', '⠹', '⠸', '⠼', '⠴', '⠦', '⠧', '⠇', '⠏'];
const INTERVAL_MS = 80;

export class Spinner {
  private frameIndex = 0;
  private interval: ReturnType<typeof setInterval> | undefined;

  constructor(private readonly onTick: () => void) {}

  get current(): string {
    return FRAMES[this.frameIndex] ?? FRAMES[0]!;
  }

  reset(): void {
    this.frameIndex = 0;
  }

  start(): void {
    if (this.interval !== undefined) return;
    this.interval = setInterval(() => {
      this.frameIndex = (this.frameIndex + 1) % FRAMES.length;
      this.onTick();
    }, INTERVAL_MS);
  }

  stop(): void {
    if (this.interval === undefined) return;
    clearInterval(this.interval);
    this.interval = undefined;
  }
}
