/** Framework-free lifecycle orchestration for deterministic startup/resume tests. */
export class EngineLifecycle {
  private started = false;
  private foreground = false;
  constructor(
    private initialize: () => Promise<void>,
    private run: () => Promise<void>,
    private cancel: () => void,
    private schedule: () => void,
    private unschedule: () => void,
  ) {}
  start(): void {
    if (this.started) return;
    this.started = true;
    this.foreground = true;
    void this.initialize()
      .then(() => {
        if (this.foreground) {
          void this.run()
            .finally(() => {
              if (this.foreground) this.schedule();
            })
            .catch(() => {
              if (this.foreground) this.schedule();
            });
        }
      })
      .catch(() => {
        if (this.foreground) this.schedule();
      });
  }
  change(active: boolean): void {
    this.foreground = active;
    if (!active) {
      this.unschedule();
      this.cancel();
    } else if (this.started) {
      void this.initialize()
        .then(() => this.run())
        .finally(() => {
          if (this.foreground) this.schedule();
        })
        .catch(() => {
          if (this.foreground) this.schedule();
        });
    }
  }
  stop(): void {
    this.started = false;
    this.foreground = false;
    this.unschedule();
    this.cancel();
  }
}
