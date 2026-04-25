# Stitch Direct Connection in Cursor/Codex

This enables a direct Stitch bridge via MCP so you can pull tokens/components from Stitch in chat.

## Files added

- `BACKEND/scripts/stitch-mcp-server.js`
- `BACKEND/.env.stitch.example`
- `.cursor/mcp.json`

## 1) Configure credentials

Use `.cursor/mcp.json` and replace:

- `STITCH_API_BASE_URL`
- `STITCH_API_TOKEN`

You can also override:

- `STITCH_AUTH_HEADER` (default `Authorization`)
- `STITCH_TOKEN_PREFIX` (default `Bearer`)

## 2) Restart Cursor MCP

After saving `.cursor/mcp.json`, reload Cursor window so the MCP server is picked up.

## 3) Available Stitch MCP tools

- `stitch_get_tokens`
- `stitch_get_components`
- `stitch_custom_request`

## 4) Example requests

- Get tokens:
  - tool: `stitch_get_tokens`
  - args: `{ "path": "/tokens", "projectId": "..." }`

- Get components/screens:
  - tool: `stitch_get_components`
  - args: `{ "path": "/components", "fileId": "..." }`

- Direct endpoint:
  - tool: `stitch_custom_request`
  - args: `{ "method": "GET", "path": "/files/123" }`

## 5) Optional local run

From `BACKEND/`:

```bash
npm run mcp:stitch
```

This runs the same MCP bridge over stdio.

## 6) Auto push QC design from local file

You can push your current local QC design (`PUBLIC/QCSupervisor.html`) to Stitch:

1. Set in env:
   - `STITCH_API_BASE_URL`
   - `STITCH_API_TOKEN`
   - `STITCH_PUSH_PATH` (your Stitch import/update endpoint)
2. Optional:
   - `STITCH_PROJECT_ID`
   - `STITCH_FILE_ID`
   - `STITCH_COMPONENT_NAME`
   - `STITCH_PAYLOAD_MODE` (`html_css` or `raw`)

Run:

```bash
npm run stitch:push:qc
```

Script file: `BACKEND/scripts/push-qc-design-to-stitch.js`
