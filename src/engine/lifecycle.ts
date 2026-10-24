/** Framework-free lifecycle orchestration; stale foreground requests never restart work. */
export class EngineLifecycle {
  private started = false;
  private foreground = false;
  private generation = 0;
  constructor(
    private initialize: () => Promise<void>,
    private run: () => Promise<void>,
    private cancel: () => void,
    private schedule: () => void,
    private unschedule: () => void,
  ) {}
  private resume(): void {
    const generation = ++this.generation;
    void this.initialize().then(async () => {
      if (!this.started || !this.foreground || this.generation !== generation) return;
      await this.run();
    }).catch(() => undefined).finally(() => {
      if (this.started && this.foreground && this.generation === generation) this.schedule();
    });
  }
  start(): void {
    if (this.started) return;
    this.started = true;
    this.foreground = true;
    this.resume();
  }
  change(active: boolean): void {
    this.foreground = active;
    if (!active) {
      this.generation++;
      this.unschedule();
      this.cancel();
    } else if (this.started) this.resume();
  }
  stop(): void {
    this.started = false;
    this.foreground = false;
    this.generation++;
    this.unschedule();
    this.cancel();
  }
}
