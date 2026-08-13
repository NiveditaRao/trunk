# MCP host registration

Trunk is a plain stdio MCP server. It does not depend on host-specific APIs.

Use a built local server while the package is unpublished:

```bash
npm run build
node /absolute/path/to/trunk/packages/server/dist/index.js
```

Replace paths below with your local checkout. Add secrets through the host's `env` block or your shell environment; do not commit them.

## Copilot CLI

Verified from GitHub's Copilot CLI MCP docs: global config uses top-level `mcpServers`; project config can use `.mcp.json` or `.github/mcp.json`.

Locations:

| Scope | macOS/Linux | Windows |
|---|---|---|
| Global | `~/.copilot/mcp-config.json` | `%USERPROFILE%\.copilot\mcp-config.json` |
| Project | `.mcp.json` or `.github/mcp.json` | same, under the workspace |

Config:

```json
{
  "mcpServers": {
    "trunk": {
      "type": "stdio",
      "command": "node",
      "args": ["/absolute/path/to/trunk/packages/server/dist/index.js"],
      "tools": ["*"]
    }
  }
}
```

Windows path example:

```json
{
  "mcpServers": {
    "trunk": {
      "type": "stdio",
      "command": "node",
      "args": ["C:\\Users\\you\\Projects\\trunk\\packages\\server\\dist\\index.js"],
      "tools": ["*"]
    }
  }
}
```

## Claude Code

Verified from Claude Code MCP docs: `claude mcp add` accepts local stdio servers, and project config lives in `.mcp.json`.

Fast path:

```bash
claude mcp add --transport stdio trunk -- node /absolute/path/to/trunk/packages/server/dist/index.js
```

Project config location:

```text
<project-root>/.mcp.json
```

User config location:

```text
~/.claude.json
```

Project config:

```json
{
  "mcpServers": {
    "trunk": {
      "type": "stdio",
      "command": "node",
      "args": ["/absolute/path/to/trunk/packages/server/dist/index.js"]
    }
  }
}
```

On Windows, if the host cannot resolve `node` directly, wrap through `cmd`:

```json
{
  "mcpServers": {
    "trunk": {
      "type": "stdio",
      "command": "cmd",
      "args": ["/c", "node", "C:\\Users\\you\\Projects\\trunk\\packages\\server\\dist\\index.js"]
    }
  }
}
```

## Cursor

Verified from Cursor MCP docs: `mcp.json` uses top-level `mcpServers`; stdio entries include `type`, `command`, and optional `args`/`env`.

Locations:

| Scope | macOS/Linux | Windows |
|---|---|---|
| Global | `~/.cursor/mcp.json` | `%USERPROFILE%\.cursor\mcp.json` |
| Project | `<project-root>/.cursor/mcp.json` | same, under the workspace |

Config:

```json
{
  "mcpServers": {
    "trunk": {
      "type": "stdio",
      "command": "node",
      "args": ["/absolute/path/to/trunk/packages/server/dist/index.js"]
    }
  }
}
```

## Windsurf

Verified from Windsurf/Cascade MCP docs: `mcp_config.json` uses top-level `mcpServers` for stdio servers.

Locations:

| macOS/Linux | Windows |
|---|---|
| `~/.codeium/windsurf/mcp_config.json` | `%USERPROFILE%\.codeium\windsurf\mcp_config.json` |

Config:

```json
{
  "mcpServers": {
    "trunk": {
      "command": "node",
      "args": ["/absolute/path/to/trunk/packages/server/dist/index.js"]
    }
  }
}
```

Windsurf also lets you open the file from the Command Palette with `Windsurf: Configure MCP Servers` / the Cascade MCPs menu.

## Zed

Verified from Zed MCP docs: Zed uses `context_servers` in `settings.json`, not `mcpServers`.

Locations:

| macOS/Linux | Windows |
|---|---|
| `~/.config/zed/settings.json` | `%APPDATA%\Zed\settings.json` |

Config:

```json
{
  "context_servers": {
    "trunk": {
      "command": "node",
      "args": ["/absolute/path/to/trunk/packages/server/dist/index.js"],
      "env": {}
    }
  }
}
```

## Published-package form

Once `trunk-mcp` is published, the stdio command can become:

```json
{
  "command": "npx",
  "args": ["-y", "trunk-mcp"]
}
```

Do not use this form on the blocked corporate machine; it requires `registry.npmjs.org`.

## Verification notes

First-party docs were reachable for Copilot CLI, Claude Code, Cursor, Windsurf, and Zed. I did not find a first-party Windsurf page that documented a Windows-specific path; the Windows path above follows Windsurf's documented home-relative config path convention and current public setup guides.
