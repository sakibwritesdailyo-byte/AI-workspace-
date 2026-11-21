export interface RateLimiterConfig {
  windowMs: number;
  maxRequestsPerWindow: number;
  maxConcurrentPerUser: number;
}

export interface RateLimitConsumeResult {
  allowed: true;
  remainingRequests: number;
  release: () => void;
}

export interface RateLimitDeniedResult {
  allowed: false;
  reason: 'window_limit' | 'concurrent_limit';
  retryAfterSeconds: number;
  message: string;
}

interface UserBucket {
  timestamps: number[];
  activeStreams: number;
}

export class UserRateLimiter {
  private readonly config: RateLimiterConfig;
  private readonly buckets = new Map<string, UserBucket>();
  private readonly nowFn: () => number;

  constructor(
    config: Partial<RateLimiterConfig> = {},
    nowFn: () => number = () => Date.now(),
  ) {
    this.config = {
      windowMs: config.windowMs ?? 60_000,
      maxRequestsPerWindow: config.maxRequestsPerWindow ?? 20,
      maxConcurrentPerUser: config.maxConcurrentPerUser ?? 2,
    };
    this.nowFn = nowFn;
  }

  tryConsume(key: string): RateLimitConsumeResult | RateLimitDeniedResult {
    const now = this.nowFn();
    const windowStart = now - this.config.windowMs;
    const bucket = this.buckets.get(key) ?? { timestamps: [], activeStreams: 0 };

    bucket.timestamps = bucket.timestamps.filter((ts) => ts > windowStart);

    if (bucket.activeStreams >= this.config.maxConcurrentPerUser) {
      this.buckets.set(key, bucket);
      return {
        allowed: false,
        reason: 'concurrent_limit',
        retryAfterSeconds: 2,
        message:
          'Another response is currently streaming for your account. Wait for it to finish or stop it before sending a new request.',
      };
    }

    if (bucket.timestamps.length >= this.config.maxRequestsPerWindow) {
      const oldest = bucket.timestamps[0] ?? now;
      const retryMs = Math.max(1000, oldest + this.config.windowMs - now);
      this.buckets.set(key, bucket);
      return {
        allowed: false,
        reason: 'window_limit',
        retryAfterSeconds: Math.ceil(retryMs / 1000),
        message: `Rate limit reached (${this.config.maxRequestsPerWindow} requests per minute). Please wait a moment before retrying.`,
      };
    }

    bucket.timestamps.push(now);
    bucket.activeStreams += 1;
    this.buckets.set(key, bucket);
    this.pruneInactive(windowStart);

    let released = false;
    return {
      allowed: true,
      remainingRequests: Math.max(0, this.config.maxRequestsPerWindow - bucket.timestamps.length),
      release: () => {
        if (released) return;
        released = true;
        const current = this.buckets.get(key);
        if (!current) return;
        current.activeStreams = Math.max(0, current.activeStreams - 1);
        if (current.activeStreams === 0 && current.timestamps.length === 0) {
          this.buckets.delete(key);
        }
      },
    };
  }

  getActiveCount(key: string): number {
    return this.buckets.get(key)?.activeStreams ?? 0;
  }

  private pruneInactive(windowStart: number): void {
    if (this.buckets.size <= 250) return;
    for (const [k, b] of this.buckets.entries()) {
      b.timestamps = b.timestamps.filter((ts) => ts > windowStart);
      if (b.activeStreams === 0 && b.timestamps.length === 0) {
        this.buckets.delete(k);
      }
    }
  }
}
