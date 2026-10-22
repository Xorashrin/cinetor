export interface BackgroundPlatform {
  available(): Promise<boolean>;
  registered(): Promise<boolean>;
  register(): Promise<void>;
}
export class BackgroundCoordinator {
  private active: Promise<boolean> | null = null;
  constructor(private platform: BackgroundPlatform) {}
  register(): Promise<boolean> {
    if (this.active) return this.active;
    this.active = (async () => {
      if (!(await this.platform.available())) return false;
      if (!(await this.platform.registered())) await this.platform.register();
      return true;
    })().finally(() => {
      this.active = null;
    });
    return this.active;
  }
}
