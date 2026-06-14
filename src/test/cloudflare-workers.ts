export const env: Record<string, unknown> = {};

export class DurableObject<T = unknown> {
  protected readonly ctx?: T;

  constructor(ctx?: T) {
    this.ctx = ctx;
  }
}
