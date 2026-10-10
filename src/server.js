import { readFileSync } from 'node:fs';
import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { z } from 'zod';
import { DataSource } from './data.js';
import { SITE, DEFAULT_LIMIT, MAX_LIMIT } from './catalog.js';

const pkg = JSON.parse(readFileSync(new URL('../package.json', import.meta.url), 'utf8'));

const READ_ONLY = { readOnlyHint: true, destructiveHint: false, idempotentHint: true, openWorldHint: true };

function fmtStars(r) {
  if (r.stars != null) return `★ ${r.stars.toLocaleString('en-US')}`;
  if (r.stats_note) return 'shared repo';
  return 'no stats';
}

function fmtCompact(r, i) {
  return [
    `${i + 1}. ${r.name} (${fmtStars(r)})`,
    `   ${r.description}`,
    `   tags: ${r.tags.join(', ') || '-'}`,
    `   repo: ${r.repo_url || '-'}`,
    `   details: ${r.detail_url}`,
  ].join('\n');
}

const ok = (text, structuredContent) => ({ content: [{ type: 'text', text }], structuredContent });
const fail = (text) => ({ content: [{ type: 'text', text }], isError: true });

export function createServer({ data = new DataSource() } = {}) {
  const server = new McpServer({ name: 'mcptools-mcp', version: pkg.version });

  const guard = (fn) => async (args) => {
    try {
      return await fn(await data.catalog(), args);
    } catch (err) {
      return fail(`Could not load the mcptools.si directory (${data.url}): ${err?.message || err}`);
    }
  };

  const limitSchema = z
    .number()
    .int()
    .optional()
    .describe(`Max results (default ${DEFAULT_LIMIT}, clamped to 1-${MAX_LIMIT}).`);

  server.registerTool(
    'search_mcp_servers',
    {
      title: 'Search MCP servers',
      description:
        `Search the ${SITE} directory of MCP (Model Context Protocol) servers by keyword. ` +
        'Case-insensitive ranked match over server name, description and tags; ties broken by GitHub stars. ' +
        'Optionally restrict to one tag (e.g. "database", "aws", "search"; see list_tags). ' +
        'Returns name, one-line description, tags, stars (omitted for listings in a shared monorepo), repo URL and mcptools.si detail URL. ' +
        'Use get_mcp_server for full details on one result.',
      inputSchema: {
        query: z.string().describe('Keywords, e.g. "postgres", "browser automation", "github issues". May be empty when tag is set.'),
        tag: z.string().optional().describe('Only return servers with this tag (case-insensitive).'),
        limit: limitSchema,
      },
      annotations: { title: 'Search MCP servers', ...READ_ONLY },
    },
    guard((cat, { query, tag, limit }) => {
      if (!String(query || '').trim() && !tag) return fail('Provide a query (or a tag). Example: {"query": "postgres"}');
      const r = cat.search(query, { tag, limit });
      if (!r.tagFound) {
        const sug = cat.suggestTags(tag);
        return fail(`Unknown tag "${tag}".` + (sug.length ? ` Did you mean: ${sug.join(', ')}?` : '') + ' Use list_tags to see all tags.');
      }
      const head = `${r.total} match${r.total === 1 ? '' : 'es'} for "${query}"${r.tag ? ` in tag "${r.tag}"` : ''}` +
        (r.total > r.results.length ? ` (showing top ${r.results.length})` : '');
      const text = r.results.length
        ? `${head}\n\n${r.results.map(fmtCompact).join('\n\n')}`
        : `${head}. Try fewer or broader keywords, or browse ${SITE}/tags/.`;
      return ok(text, { query, tag: r.tag, total: r.total, results: r.results });
    }),
  );

  server.registerTool(
    'list_tags',
    {
      title: 'List tags',
      description:
        `List every tag (category) in the ${SITE} MCP server directory with the number of servers in each, most common first. ` +
        'Tags with a category page on the site include its URL. Use with list_by_tag or the tag filter of search_mcp_servers.',
      inputSchema: {},
      annotations: { title: 'List tags', ...READ_ONLY },
    },
    guard((cat) => {
      const tags = cat.listTags();
      const text = `${tags.length} tags across ${cat.tools.length} MCP servers (count, tag, page):\n` +
        tags.map((t) => `${t.count}\t${t.tag}${t.url ? `\t${t.url}` : ''}`).join('\n');
      return ok(text, { total_servers: cat.tools.length, tags });
    }),
  );

  server.registerTool(
    'list_by_tag',
    {
      title: 'List MCP servers by tag',
      description:
        `List MCP servers in one ${SITE} tag/category, sorted by GitHub stars (servers in shared monorepos have no per-server stars and sort last). ` +
        'Returns the tag page URL plus compact results. Use list_tags to discover tag names.',
      inputSchema: {
        tag: z.string().describe('Tag name, e.g. "database", "official", "aws" (case-insensitive).'),
        limit: limitSchema,
      },
      annotations: { title: 'List MCP servers by tag', ...READ_ONLY },
    },
    guard((cat, { tag, limit }) => {
      const r = cat.listByTag(tag, limit);
      if (!r.found) {
        return fail(`Unknown tag "${tag}".` + (r.suggestions.length ? ` Did you mean: ${r.suggestions.join(', ')}?` : '') + ' Use list_tags to see all tags.');
      }
      const text = `Tag "${r.tag}": ${r.count} server${r.count === 1 ? '' : 's'}` +
        (r.count > r.results.length ? ` (showing top ${r.results.length} by stars)` : '') +
        `\nTag page: ${r.tag_url || `(no dedicated page; browse ${SITE}/)`}\n\n` +
        r.results.map(fmtCompact).join('\n\n');
      return ok(text, { tag: r.tag, count: r.count, tag_url: r.tag_url, results: r.results });
    }),
  );

  server.registerTool(
    'get_mcp_server',
    {
      title: 'Get MCP server details',
      description:
        `Get full details for one MCP server listed on ${SITE}: description, tags (with tag page URLs), repo, stars/forks/watchers ` +
        '(hidden when the repo is a shared monorepo), stats date and the mcptools.si detail URL. ' +
        'Accepts the display name ("Filesystem"), the slug ("aws-dynamodb") or a detail URL. Suggests close matches if not found.',
      inputSchema: {
        name_or_slug: z.string().describe('Server name, slug, or https://mcptools.si/mcp/<slug>/ URL.'),
      },
      annotations: { title: 'Get MCP server details', ...READ_ONLY },
    },
    guard((cat, { name_or_slug }) => {
      const t = cat.find(name_or_slug);
      if (!t) {
        const sug = cat.suggest(name_or_slug);
        return fail(
          `No MCP server named "${name_or_slug}" on ${SITE}.` +
            (sug.length ? `\nDid you mean:\n${sug.map((s) => `- ${s.name} (${s.slug})`).join('\n')}` : '') +
            '\nTry search_mcp_servers for keyword search.',
        );
      }
      const d = cat.full(t);
      const num = (n) => (n == null ? '-' : n.toLocaleString('en-US'));
      const lines = [
        `${d.name}`,
        d.description,
        '',
        `Details: ${d.detail_url}`,
        `Repo: ${d.repo_url || '-'}`,
        `Tags: ${d.tags.map((x) => x.tag).join(', ') || '-'}`,
        d.shared_repo
          ? `Stats: hidden (shared repo ${d.repo}; stars belong to the monorepo, not this server)`
          : `Stars: ${num(d.stars)} · Forks: ${num(d.forks)} · Watchers: ${num(d.watchers)}` +
            (d.stats_refreshed_at ? ` (as of ${d.stats_refreshed_at.slice(0, 10)})` : ''),
      ];
      const tagPages = d.tags.filter((x) => x.url);
      if (tagPages.length) lines.push(`Tag pages: ${tagPages.map((x) => x.url).join(' ')}`);
      return ok(lines.join('\n'), d);
    }),
  );

  return server;
}
