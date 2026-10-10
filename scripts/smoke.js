// Live smoke test: hits the real https://mcptools.si/data/tools.json.
import { DataSource, DEFAULT_DATA_URL } from '../src/data.js';

const q = process.argv[2] || 'postgres';
const data = new DataSource({ url: process.env.MCPTOOLS_DATA_URL || DEFAULT_DATA_URL });
const t0 = Date.now();
const cat = await data.catalog();
console.log(`Loaded ${cat.tools.length} listings from ${data.url} in ${Date.now() - t0} ms`);
const r = cat.search(q, { limit: 5 });
console.log(`search "${q}": ${r.total} matches, top ${r.results.length}:`);
for (const x of r.results) console.log(`- ${x.name} [${x.stars ?? 'shared/no stats'}] ${x.detail_url}`);
if (!r.total) process.exit(1);
