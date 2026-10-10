// Pure catalog logic over the mcptools.si tools.json listing array.
// Mirrors the site's rules (scripts/build-pages.py, public/app.js):
//   - slugify(): detail pages at /mcp/<slug>/, tag pages at /tags/<slug>/
//   - a repo shared by >1 listing has monorepo stats -> hidden
//   - tag pages are only built for tags with >= MIN_TAG listings

export const SITE = 'https://mcptools.si';
export const MIN_TAG = 3;
export const DEFAULT_LIMIT = 10;
export const MAX_LIMIT = 50;

/** Same as the site's slugify (build-pages.py / app.js). */
export function slugify(s) {
  return String(s ?? '')
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/-+/g, '-')
    .replace(/^-+|-+$/g, '');
}

export function clampLimit(limit, def = DEFAULT_LIMIT) {
  const n = Number(limit);
  if (limit == null || !Number.isFinite(n)) return def;
  return Math.min(MAX_LIMIT, Math.max(1, Math.floor(n)));
}

const repoOf = (t) => (typeof t.repo === 'string' ? t.repo.trim() : '');

export class Catalog {
  constructor(tools) {
    if (!Array.isArray(tools)) throw new Error('tools.json must be a JSON array of listings');
    this.tools = tools.filter((t) => t && typeof t.name === 'string' && slugify(t.name));
    const repoUse = new Map();
    for (const t of this.tools) {
      const r = repoOf(t);
      if (r) repoUse.set(r, (repoUse.get(r) || 0) + 1);
    }
    this.shared = new Set([...repoUse].filter(([, n]) => n > 1).map(([r]) => r));
    this.bySlug = new Map(this.tools.map((t) => [slugify(t.name), t]));
    this.tagCounts = new Map();
    for (const t of this.tools) {
      for (const tag of new Set(t.tags || [])) this.tagCounts.set(tag, (this.tagCounts.get(tag) || 0) + 1);
    }
  }

  isShared(t) {
    return this.shared.has(repoOf(t));
  }

  /** Own stat, or null when missing or when stats belong to a shared monorepo. */
  ownStat(t, key) {
    if (this.isShared(t)) return null;
    const n = t[key];
    return typeof n === 'number' && !Number.isNaN(n) ? n : null;
  }

  detailUrl(t) {
    return `${SITE}/mcp/${slugify(t.name)}/`;
  }

  /** Tag page URL, or null when the site doesn't build a page for that tag. */
  tagUrl(tag) {
    return (this.tagCounts.get(tag) || 0) >= MIN_TAG ? `${SITE}/tags/${slugify(tag)}/` : null;
  }

  /** Resolve a user-supplied tag case-insensitively or by slug. */
  resolveTag(tag) {
    if (tag == null || tag === '') return null;
    const q = String(tag).trim().toLowerCase();
    const qs = slugify(q);
    for (const k of this.tagCounts.keys()) if (k.toLowerCase() === q) return k;
    for (const k of this.tagCounts.keys()) if (slugify(k) === qs) return k;
    return undefined;
  }

  byStars(items) {
    return [...items].sort((a, b) => {
      const sa = this.ownStat(a, 'stars');
      const sb = this.ownStat(b, 'stars');
      if ((sa == null) !== (sb == null)) return sa == null ? 1 : -1;
      if ((sb || 0) !== (sa || 0)) return (sb || 0) - (sa || 0);
      return a.name.toLowerCase().localeCompare(b.name.toLowerCase());
    });
  }

  compact(t) {
    const out = {
      name: t.name,
      slug: slugify(t.name),
      description: oneLine(t.description),
      tags: t.tags || [],
    };
    const stars = this.ownStat(t, 'stars');
    if (stars != null) out.stars = stars;
    else if (this.isShared(t)) out.stats_note = `shared repo (${repoOf(t)}); stars not per-server`;
    out.repo_url = t.url || (repoOf(t) ? `https://github.com/${repoOf(t)}` : null);
    out.detail_url = this.detailUrl(t);
    return out;
  }

  full(t) {
    const shared = this.isShared(t);
    return {
      name: t.name,
      slug: slugify(t.name),
      description: t.description || '',
      tags: (t.tags || []).map((tag) => ({ tag, url: this.tagUrl(tag) })),
      repo: repoOf(t) || null,
      repo_url: t.url || (repoOf(t) ? `https://github.com/${repoOf(t)}` : null),
      shared_repo: shared,
      stars: this.ownStat(t, 'stars'),
      forks: this.ownStat(t, 'forks'),
      watchers: this.ownStat(t, 'watchers'),
      stats_refreshed_at: t.stats_refreshed_at || null,
      detail_url: this.detailUrl(t),
    };
  }

  score(t, q, terms) {
    const name = t.name.toLowerCase();
    const slug = slugify(t.name);
    const desc = String(t.description || '').toLowerCase();
    const tags = (t.tags || []).map((x) => String(x).toLowerCase());
    let s = 0;
    let matched = 0;
    if (name === q || slug === slugify(q)) s += 100;
    else if (name.startsWith(q)) s += 50;
    else if (name.includes(q)) s += 35;
    if (terms.length > 1 && desc.includes(q)) s += 10;
    for (const term of terms) {
      let hit = false;
      if (name.includes(term)) { s += 10; hit = true; }
      if (tags.includes(term)) { s += 8; hit = true; } else if (tags.some((x) => x.includes(term))) { s += 4; hit = true; }
      if (desc.includes(term)) { s += 3; hit = true; }
      if (hit) matched++;
    }
    if (!matched) return 0;
    return s + matched * 20 + (matched === terms.length ? 25 : 0);
  }

  /** Ranked search. Empty query + tag lists the tag by stars. */
  search(query, { tag, limit } = {}) {
    const n = clampLimit(limit);
    let pool = this.tools;
    let resolvedTag = null;
    if (tag != null && tag !== '') {
      resolvedTag = this.resolveTag(tag);
      if (!resolvedTag) return { tag: String(tag), tagFound: false, total: 0, results: [] };
      pool = pool.filter((t) => (t.tags || []).includes(resolvedTag));
    }
    const q = String(query ?? '').trim().toLowerCase();
    const terms = q.split(/[^a-z0-9]+/).filter(Boolean);
    let ranked;
    if (!terms.length) {
      ranked = this.byStars(pool);
    } else {
      const scored = pool.map((t) => ({ t, s: this.score(t, q, terms) })).filter((x) => x.s > 0);
      const starKey = (t) => this.ownStat(t, 'stars') ?? -1;
      scored.sort((a, b) => b.s - a.s || starKey(b.t) - starKey(a.t) || a.t.name.localeCompare(b.t.name));
      ranked = scored.map((x) => x.t);
    }
    return { tag: resolvedTag, tagFound: true, total: ranked.length, results: ranked.slice(0, n).map((t) => this.compact(t)) };
  }

  listTags() {
    return [...this.tagCounts]
      .sort((a, b) => b[1] - a[1] || a[0].localeCompare(b[0]))
      .map(([tag, count]) => ({ tag, count, url: this.tagUrl(tag) }));
  }

  listByTag(tag, limit) {
    const resolved = this.resolveTag(tag);
    if (!resolved) return { tag: String(tag ?? ''), found: false, suggestions: this.suggestTags(tag) };
    const items = this.byStars(this.tools.filter((t) => (t.tags || []).includes(resolved)));
    return {
      tag: resolved,
      found: true,
      count: items.length,
      tag_url: this.tagUrl(resolved),
      results: items.slice(0, clampLimit(limit)).map((t) => this.compact(t)),
    };
  }

  find(nameOrSlug) {
    const raw = String(nameOrSlug ?? '').trim();
    // accept a pasted detail URL too
    const m = raw.match(/\/mcp\/([^/?#]+)\/?/);
    const key = slugify(m ? m[1] : raw);
    if (!key) return null;
    return this.bySlug.get(key) || this.tools.find((t) => t.name.toLowerCase() === raw.toLowerCase()) || null;
  }

  suggest(nameOrSlug, max = 5) {
    const key = slugify(nameOrSlug);
    if (!key) return [];
    const scored = this.tools.map((t) => {
      const s = slugify(t.name);
      let d = levenshtein(key, s);
      if (s.includes(key) || key.includes(s)) d = Math.min(d, 1);
      else if (key.split('-').some((p) => p.length > 2 && s.includes(p))) d = Math.min(d, 2 + Math.abs(s.length - key.length) / 10);
      return { t, d };
    });
    const cutoff = Math.max(3, Math.ceil(key.length / 2));
    return scored
      .filter((x) => x.d <= cutoff)
      .sort((a, b) => a.d - b.d || a.t.name.localeCompare(b.t.name))
      .slice(0, max)
      .map((x) => ({ name: x.t.name, slug: slugify(x.t.name), detail_url: this.detailUrl(x.t) }));
  }

  suggestTags(tag, max = 5) {
    const key = slugify(tag);
    if (!key) return [];
    return [...this.tagCounts.keys()]
      .map((k) => ({ k, d: slugify(k).includes(key) || key.includes(slugify(k)) ? 0 : levenshtein(key, slugify(k)) }))
      .filter((x) => x.d <= Math.max(2, Math.ceil(key.length / 3)))
      .sort((a, b) => a.d - b.d || (this.tagCounts.get(b.k) - this.tagCounts.get(a.k)))
      .slice(0, max)
      .map((x) => x.k);
  }
}

export function oneLine(s) {
  const t = String(s || '').replace(/\s+/g, ' ').trim();
  return t.length > 200 ? t.slice(0, 197) + '...' : t;
}

export function levenshtein(a, b) {
  if (a === b) return 0;
  let prev = Array.from({ length: b.length + 1 }, (_, i) => i);
  for (let i = 1; i <= a.length; i++) {
    const cur = [i];
    for (let j = 1; j <= b.length; j++) {
      cur[j] = Math.min(prev[j] + 1, cur[j - 1] + 1, prev[j - 1] + (a[i - 1] === b[j - 1] ? 0 : 1));
    }
    prev = cur;
  }
  return prev[b.length];
}
