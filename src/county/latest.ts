/** Invalidates work immediately on new intent, not when its replacement finishes. */
export class LatestRequest {
  private generation = 0;
  private disposed = false;

  next(): number {
    return ++this.generation;
  }

  isCurrent(generation: number): boolean {
    return !this.disposed && generation === this.generation;
  }

  dispose(): void {
    this.disposed = true;
    this.generation++;
  }
}
