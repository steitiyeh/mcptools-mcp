import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createServer } from 'node:http';
import { readFileSync } from 'node:fs';
import { DataSource } from '../src/data.js';

const body = readFileSync(new URL('./fixtures/tools.json', import.meta.url));

test('fetches over http, caches, and serves stale data if a refresh fails', async () => {
  let hits = 0;
  let fail = false;
  const srv = createServer((req, res) => {
    hits++;
    if (fail) { res.writeHead(500); return res.end(); }
    res.writeHead(200, { 'content-type': 'application/json' });
    res.end(body);
  });
  await new Promise((r) => srv.listen(0, '127.0.0.1', r));
  const url = `http://127.0.0.1:${srv.address().port}/data/tools.json`;
  try {
    const ds = new DataSource({ url, ttlMs: 60_000 });
    const c1 = await ds.catalog();
    await ds.catalog();
    assert.equal(hits, 1, 'cached within TTL');
    ds.loadedAt = 0; // expire
    fail = true;
    assert.equal(await ds.catalog(), c1, 'stale cache on refresh failure');
    assert.equal(hits, 2);
    const fresh = new DataSource({ url });
    await assert.rejects(fresh.catalog(), /HTTP 500/);
  } finally {
    srv.close();
  }
});
