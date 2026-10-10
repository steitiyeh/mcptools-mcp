import { test } from 'node:test';
import assert from 'node:assert/strict';
import { fileURLToPath } from 'node:url';
import { Client } from '@modelcontextprotocol/sdk/client/index.js';
import { StdioClientTransport } from '@modelcontextprotocol/sdk/client/stdio.js';

const bin = fileURLToPath(new URL('../src/index.js', import.meta.url));
const fixture = new URL('./fixtures/tools.json', import.meta.url).href;

test('stdio server: tools/list and tools/call', async () => {
  const transport = new StdioClientTransport({
    command: process.execPath,
    args: [bin],
    env: { ...process.env, MCPTOOLS_DATA_URL: fixture },
    stderr: 'inherit',
  });
  const client = new Client({ name: 'e2e', version: '0.0.0' });
  await client.connect(transport);
  try {
    const { tools } = await client.listTools();
    assert.deepEqual(tools.map((t) => t.name).sort(), ['get_mcp_server', 'list_by_tag', 'list_tags', 'search_mcp_servers']);
    for (const t of tools) assert.ok(t.description.length > 40, `${t.name} has a description`);

    const res = await client.callTool({ name: 'search_mcp_servers', arguments: { query: 'postgres', limit: 3 } });
    assert.notEqual(res.isError, true);
    assert.match(res.content[0].text, /https:\/\/mcptools\.si\/mcp\//);
    assert.equal(res.structuredContent.results.length, 3);

    const miss = await client.callTool({ name: 'get_mcp_server', arguments: { name_or_slug: 'postgress' } });
    assert.equal(miss.isError, true);
    assert.match(miss.content[0].text, /Did you mean/);
  } finally {
    await client.close();
  }
});
