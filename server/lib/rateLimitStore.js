/**
 * An express-rate-limit store backed by the repositories, so every gateway
 * instance counts against the same totals. Each limiter gets its own prefix.
 */
class SharedRateLimitStore {
  constructor(getRepos, prefix) {
    this.getRepos = getRepos;
    this.prefix = prefix;
    this.localKeys = false;
  }

  init(options) {
    this.windowMs = options.windowMs;
  }

  async increment(key) {
    const { hits, resetAt } = await this.getRepos().rateLimits.hit(`${this.prefix}:${key}`, this.windowMs);
    return { totalHits: hits, resetTime: new Date(resetAt) };
  }

  async decrement(key) {
    await this.getRepos().rateLimits.decrement(`${this.prefix}:${key}`);
  }

  async resetKey(key) {
    await this.getRepos().rateLimits.reset(`${this.prefix}:${key}`);
  }
}

module.exports = { SharedRateLimitStore };
