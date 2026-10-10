# mcptools-mcp

**Search the [mcptools.si](https://mcptools.si) MCP directory from any MCP client.**

A small, read-only MCP server (stdio) that lets Claude, Cursor and other MCP clients find MCP servers listed on [mcptools.si](https://mcptools.si): keyword search, tags, and full details with links to each listing page.

**Data source:** the public JSON at [mcptools.si/data/tools.json](https://mcptools.si/data/tools.json), fetched on demand and cached in memory for 1 hour. No backend, no account, **no API key**.

<!-- mcp-name: io.github.steitiyeh/mcptools-mcp -->

## Install

Requires Node.js 18+. Runs straight from GitHub with `npx github:steitiyeh/mcptools-mcp`.

**Claude Desktop** (`claude_desktop_config.json`) / **Cursor** (`~/.cursor/mcp.json` or `.cursor/mcp.json`):

```json
{
  "mcpServers": {
    "mcptools": {
      "command": "npx",
      "args": ["-y", "github:steitiyeh/mcptools-mcp"]
    }
  }
}
```

**Claude Code:**

```sh
claude mcp add mcptools -- npx -y github:steitiyeh/mcptools-mcp
```

## Tools

| Tool | Arguments | What it does |
| --- | --- | --- |
| `search_mcp_servers` | `query`, `tag?`, `limit?` (10, max 50) | Ranked, case-insensitive match over name, description and tags; ties broken by GitHub stars. |
| `list_tags` | none | All tags with server counts, most common first, plus tag page URLs. |
| `list_by_tag` | `tag`, `limit?` | Servers in a tag sorted by stars, plus the `mcptools.si/tags/<tag>/` page. |
| `get_mcp_server` | `name_or_slug` | Full details for one listing (name, slug or detail URL). Suggests close matches if not found. |

Each result includes the repo URL and the `https://mcptools.si/mcp/<slug>/` detail page. Stars are omitted for servers that live in a shared monorepo (e.g. `modelcontextprotocol/servers`, `awslabs/mcp`), the same way the site handles them. Tools return readable text plus `structuredContent`.

## Example prompts

- "Find an MCP server for Postgres."
- "What MCP servers are there for browser automation? Show the top 5 by stars."
- "List the tags on mcptools.si, then show me the AWS servers."
- "Give me details on the GitHub MCP server."

## Configuration

| Env var | Default | Purpose |
| --- | --- | --- |
| `MCPTOOLS_DATA_URL` | `https://mcptools.si/data/tools.json` | Override the data source (`http(s)://` or `file://`), for tests or offline use. |

## Registries

- **Official MCP Registry:** `server.json` (name `io.github.steitiyeh/mcptools-mcp`, npm package `mcptools-mcp`, stdio).
- **Smithery:** `smithery.yaml` (stdio, no config needed).
- **Glama:** `glama.json`. No credentials or setup: install with the `npx` command above, and the four tools listed above are available right away. The server only does read-only HTTPS GETs to mcptools.si.

## Development

```sh
npm install
npm test        # offline: node:test against test/fixtures/tools.json, plus a stdio end-to-end test
npm run smoke   # live: fetches mcptools.si and runs one search
```

## License

MIT © Firas Steitiyeh. Directory data: [mcptools.si](https://mcptools.si).
