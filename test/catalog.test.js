import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { Catalog, slugify, clampLimit, MAX_LIMIT } from '../src/catalog.js';
import { DataSource } from '../src/data.js';

const fixtureUrl = new URL('./fixtures/tools.json', import.meta.url);
const tools = JSON.parse(readFileSync(fixtureUrl, 'utf8'));
const cat = new Catalog(tools);

test('slugify matches the site slugify() for every listing and edge cases', () => {
  const expected = JSON.parse(readFileSync(new URL('./fixtures/slugs.json', import.meta.url), 'utf8'));
  for (const [name, slug] of Object.entries(expected)) assert.equal(slugify(name), slug, name);
  assert.equal(slugify('shadcn/ui'), 'shadcn-ui');
});

test('loads fixture through MCPTOOLS_DATA_URL (file://)', async () => {
  const prev = process.env.MCPTOOLS_DATA_URL;
  process.env.MCPTOOLS_DATA_URL = fixtureUrl.href;
  try {
    const ds = new DataSource();
    assert.equal(ds.url, fixtureUrl.href);
    const c = await ds.catalog();
    assert.equal(c.tools.length, tools.length);
    assert.equal(await ds.catalog(), c, 'second call served from cache');
  } finally {
    if (prev === undefined) delete process.env.MCPTOOLS_DATA_URL; else process.env.MCPTOOLS_DATA_URL = prev;
  }
});

test('search ranks name matches first and is case-insensitive', () => {
  const r = cat.search('POSTGRES');
  assert.ok(r.total >= 2);
  const top2 = r.results.slice(0, 2).map((x) => x.name);
  assert.ok(top2.every((n) => /postgres/i.test(n)), `top results should have postgres in name: ${top2}`);
  assert.equal(cat.search('github').results[0].name, 'GitHub');
  // exact name beats partial
  assert.equal(cat.search('filesystem').results[0].name, 'Filesystem');
  // results carry site URLs
  const first = r.results[0];
  assert.equal(first.detail_url, `https://mcptools.si/mcp/${slugify(first.name)}/`);
  assert.ok(first.repo_url.startsWith('https://'));
});

test('search ties are broken by stars (desc), shared/no-stats last', () => {
  const r = cat.search('', { tag: 'database', limit: 50 });
  const stars = r.results.map((x) => x.stars ?? -1);
  for (let i = 1; i < stars.length; i++) assert.ok(stars[i - 1] >= stars[i], `sorted by stars at ${i}`);
  // two listings with identical score: higher stars wins
  const tiny = new Catalog([
    { name: 'Alpha Notes', description: 'notes', tags: ['x'], repo: 'a/a', stars: 5 },
    { name: 'Beta Notes', description: 'notes', tags: ['x'], repo: 'b/b', stars: 50 },
  ]);
  assert.deepEqual(tiny.search('notes').results.map((x) => x.name), ['Beta Notes', 'Alpha Notes']);
});

test('tag filter restricts results and resolves case-insensitively', () => {
  const r = cat.search('server', { tag: 'AWS', limit: 50 });
  assert.equal(r.tag, 'aws');
  assert.ok(r.results.length > 0);
  for (const x of r.results) assert.ok(x.tags.includes('aws'));
  const bad = cat.search('x', { tag: 'no-such-tag-zzz' });
  assert.equal(bad.tagFound, false);
});

test('limit defaults to 10 and is clamped to 1..50', () => {
  assert.equal(clampLimit(undefined), 10);
  assert.equal(clampLimit(0), 1);
  assert.equal(clampLimit(-5), 1);
  assert.equal(clampLimit(500), MAX_LIMIT);
  assert.equal(clampLimit(7.9), 7);
  assert.equal(cat.search('mcp').results.length, 10);
  assert.equal(cat.search('mcp', { limit: 1000 }).results.length, Math.min(50, cat.search('mcp', { limit: 50 }).total));
  assert.equal(cat.listByTag('official', 999).results.length, 50);
});

test('shared monorepo stats are hidden (same rule as app.js)', () => {
  const fs = cat.find('Filesystem');
  assert.equal(fs.repo, 'modelcontextprotocol/servers');
  assert.ok(typeof fs.stars === 'number', 'raw data has stars');
  assert.ok(cat.isShared(fs));
  const c = cat.compact(fs);
  assert.equal('stars' in c, false);
  assert.match(c.stats_note, /shared repo/);
  const full = cat.full(fs);
  assert.equal(full.stars, null);
  assert.equal(full.forks, null);
  assert.equal(full.shared_repo, true);
  // a unique repo keeps its stars
  const gh = cat.compact(cat.find('GitHub'));
  assert.equal(typeof gh.stars, 'number');
});

test('list_tags counts and sort order', () => {
  const tags = cat.listTags();
  for (let i = 1; i < tags.length; i++) assert.ok(tags[i - 1].count >= tags[i].count);
  const official = tags.find((t) => t.tag === 'official');
  assert.equal(official.count, tools.filter((t) => (t.tags || []).includes('official')).length);
  assert.equal(official.url, 'https://mcptools.si/tags/official/');
  // tags under MIN_TAG have no page on the site
  const rare = tags.find((t) => t.count < 3);
  if (rare) assert.equal(rare.url, null);
});

test('list_by_tag sorts by stars and returns the tag page URL', () => {
  const r = cat.listByTag('Database', 50);
  assert.equal(r.found, true);
  assert.equal(r.tag_url, 'https://mcptools.si/tags/database/');
  const s = r.results.map((x) => x.stars ?? -1);
  for (let i = 1; i < s.length; i++) assert.ok(s[i - 1] >= s[i]);
  const miss = cat.listByTag('databse');
  assert.equal(miss.found, false);
  assert.ok(miss.suggestions.includes('database'));
});

test('get by name, slug or detail URL; not-found gives close matches', () => {
  assert.equal(cat.find('aws-dynamodb').name, 'AWS DynamoDB');
  assert.equal(cat.find('AWS DynamoDB').name, 'AWS DynamoDB');
  assert.equal(cat.find('https://mcptools.si/mcp/aws-dynamodb/').name, 'AWS DynamoDB');
  assert.equal(cat.find('shadcn/ui').name, 'shadcn/ui');
  assert.equal(cat.find('definitely-not-a-server-xyz'), null);
  const sug = cat.suggest('postgress').map((s) => s.name);
  assert.ok(sug.includes('PostgreSQL'), `suggestions: ${sug}`);
  assert.ok(cat.suggest('dynamo').some((s) => s.name === 'AWS DynamoDB'));
});
