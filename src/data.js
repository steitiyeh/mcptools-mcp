import { readFile } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
import { Catalog } from './catalog.js';

export const DEFAULT_DATA_URL = 'https://mcptools.si/data/tools.json';
export const TTL_MS = 60 * 60 * 1000;
export const TIMEOUT_MS = 15_000;

/** Fetches tools.json (http(s) or file://), caches it in memory for TTL_MS. */
export class DataSource {
  constructor({ url = process.env.MCPTOOLS_DATA_URL || DEFAULT_DATA_URL, ttlMs = TTL_MS, timeoutMs = TIMEOUT_MS } = {}) {
    this.url = url;
    this.ttlMs = ttlMs;
    this.timeoutMs = timeoutMs;
    this.cache = null;
    this.loadedAt = 0;
    this.inflight = null;
  }

  async catalog() {
    if (this.cache && Date.now() - this.loadedAt < this.ttlMs) return this.cache;
    if (!this.inflight) {
      this.inflight = this.load()
        .then((tools) => {
          this.cache = new Catalog(tools);
          this.loadedAt = Date.now();
          return this.cache;
        })
        .catch((err) => {
          if (this.cache) return this.cache; // serve stale data rather than fail
          throw err;
        })
        .finally(() => { this.inflight = null; });
    }
    return this.inflight;
  }

  async load() {
    if (this.url.startsWith('file:')) {
      return JSON.parse(await readFile(fileURLToPath(this.url), 'utf8'));
    }
    const res = await fetch(this.url, {
      signal: AbortSignal.timeout(this.timeoutMs),
      headers: { accept: 'application/json', 'user-agent': 'mcptools-mcp (+https://mcptools.si)' },
    });
    if (!res.ok) throw new Error(`Failed to fetch ${this.url}: HTTP ${res.status}`);
    return res.json();
  }
}
