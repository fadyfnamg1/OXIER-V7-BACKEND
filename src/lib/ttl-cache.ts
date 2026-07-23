/**
 * Minimal in-memory TTL cache.
 *
 * Used to de-duplicate identical outbound Binance requests that arrive
 * close together from many concurrent users (e.g. everyone opening the
 * BTCUSDT 1m chart at roughly the same time). Not meant to be a general
 * purpose cache — just enough to turn "N users -> N Binance requests"
 * into "N users -> 1 Binance request every TTL ms".
 */

interface CacheEntry<T> {
  value: T;
  expiresAt: number;
}

export class TTLCache<T> {
  private store = new Map<string, CacheEntry<T>>();
  // In-flight request de-duplication: if two callers ask for the same key
  // while a fetch is already underway, the second caller awaits the same
  // promise instead of firing a second request.
  private pending = new Map<string, Promise<T>>();

  get(key: string): T | undefined {
    const entry = this.store.get(key);
    if (!entry) return undefined;
    if (Date.now() > entry.expiresAt) {
      this.store.delete(key);
      return undefined;
    }
    return entry.value;
  }

  set(key: string, value: T, ttlMs: number): void {
    this.store.set(key, { value, expiresAt: Date.now() + ttlMs });
  }

  /**
   * Returns the cached value if fresh, otherwise calls `fetcher()` (at most
   * once across concurrent callers) and caches the result for `ttlMs`.
   */
  async getOrFetch(key: string, ttlMs: number, fetcher: () => Promise<T>): Promise<T> {
    const cached = this.get(key);
    if (cached !== undefined) return cached;

    const inFlight = this.pending.get(key);
    if (inFlight) return inFlight;

    const promise = (async () => {
      try {
        const value = await fetcher();
        this.set(key, value, ttlMs);
        return value;
      } finally {
        this.pending.delete(key);
      }
    })();

    this.pending.set(key, promise);
    return promise;
  }
}
