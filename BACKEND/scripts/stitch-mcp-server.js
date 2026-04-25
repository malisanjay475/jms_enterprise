#!/usr/bin/env node
/**
 * Local Stitch MCP bridge for Cursor/Codex.
 *
 * Required env:
 * - STITCH_API_BASE_URL   e.g. https://api.stitch.design/v1
 * - STITCH_API_TOKEN      API token
 *
 * Optional env:
 * - STITCH_AUTH_HEADER    defaults to Authorization
 * - STITCH_TOKEN_PREFIX   defaults to Bearer
 */

const { Server } = require("@modelcontextprotocol/sdk/server/index.js");
const { StdioServerTransport } = require("@modelcontextprotocol/sdk/server/stdio.js");
const {
  ListToolsRequestSchema,
  CallToolRequestSchema,
} = require("@modelcontextprotocol/sdk/types.js");

const BASE_URL = (process.env.STITCH_API_BASE_URL || "").replace(/\/+$/, "");
const API_TOKEN = process.env.STITCH_API_TOKEN || "";
const AUTH_HEADER = process.env.STITCH_AUTH_HEADER || "Authorization";
const TOKEN_PREFIX = process.env.STITCH_TOKEN_PREFIX || "Bearer";

function ensureConfigured() {
  if (!BASE_URL || !API_TOKEN) {
    throw new Error(
      "Missing STITCH_API_BASE_URL or STITCH_API_TOKEN. Set both before starting stitch-mcp-server."
    );
  }
}

function buildHeaders(extra = {}) {
  return {
    "Content-Type": "application/json",
    [AUTH_HEADER]: TOKEN_PREFIX ? `${TOKEN_PREFIX} ${API_TOKEN}` : API_TOKEN,
    ...extra,
  };
}

function normalizePath(inputPath) {
  if (!inputPath) return "";
  return String(inputPath).startsWith("/") ? String(inputPath) : `/${inputPath}`;
}

async function stitchRequest({ method = "GET", path = "", query = {}, body = null }) {
  ensureConfigured();
  const url = new URL(`${BASE_URL}${normalizePath(path)}`);
  Object.entries(query || {}).forEach(([k, v]) => {
    if (v !== undefined && v !== null && v !== "") url.searchParams.set(k, String(v));
  });

  const resp = await fetch(url.toString(), {
    method,
    headers: buildHeaders(),
    body: body ? JSON.stringify(body) : undefined,
  });

  const contentType = resp.headers.get("content-type") || "";
  const isJson = contentType.includes("application/json");
  const payload = isJson ? await resp.json() : await resp.text();

  if (!resp.ok) {
    throw new Error(
      `Stitch API ${resp.status} ${resp.statusText} at ${url.pathname}: ${
        typeof payload === "string" ? payload : JSON.stringify(payload)
      }`
    );
  }

  return payload;
}

const server = new Server(
  {
    name: "local-stitch-mcp",
    version: "1.0.0",
  },
  {
    capabilities: {
      tools: {},
    },
  }
);

server.setRequestHandler(ListToolsRequestSchema, async () => ({
  tools: [
    {
      name: "stitch_get_tokens",
      description: "Fetch design tokens from Stitch API.",
      inputSchema: {
        type: "object",
        properties: {
          path: {
            type: "string",
            description: "Tokens endpoint path. Default: /tokens",
            default: "/tokens",
          },
          projectId: { type: "string", description: "Optional project id query param." },
          fileId: { type: "string", description: "Optional file id query param." },
        },
      },
    },
    {
      name: "stitch_get_components",
      description: "Fetch component/screen metadata from Stitch API.",
      inputSchema: {
        type: "object",
        properties: {
          path: {
            type: "string",
            description: "Components endpoint path. Default: /components",
            default: "/components",
          },
          projectId: { type: "string", description: "Optional project id query param." },
          fileId: { type: "string", description: "Optional file id query param." },
        },
      },
    },
    {
      name: "stitch_custom_request",
      description: "Call any Stitch endpoint directly (GET/POST/PATCH/PUT/DELETE).",
      inputSchema: {
        type: "object",
        properties: {
          method: { type: "string", default: "GET" },
          path: { type: "string", description: "Endpoint path, e.g. /files/123" },
          query: { type: "object", additionalProperties: true },
          body: { type: "object", additionalProperties: true },
        },
        required: ["path"],
      },
    },
  ],
}));

server.setRequestHandler(CallToolRequestSchema, async (request) => {
  const { name, arguments: args = {} } = request.params;

  try {
    if (name === "stitch_get_tokens") {
      const data = await stitchRequest({
        method: "GET",
        path: args.path || "/tokens",
        query: {
          projectId: args.projectId,
          fileId: args.fileId,
        },
      });
      return { content: [{ type: "text", text: JSON.stringify(data, null, 2) }] };
    }

    if (name === "stitch_get_components") {
      const data = await stitchRequest({
        method: "GET",
        path: args.path || "/components",
        query: {
          projectId: args.projectId,
          fileId: args.fileId,
        },
      });
      return { content: [{ type: "text", text: JSON.stringify(data, null, 2) }] };
    }

    if (name === "stitch_custom_request") {
      const data = await stitchRequest({
        method: String(args.method || "GET").toUpperCase(),
        path: args.path,
        query: args.query || {},
        body: args.body || null,
      });
      return { content: [{ type: "text", text: JSON.stringify(data, null, 2) }] };
    }

    throw new Error(`Unknown tool: ${name}`);
  } catch (error) {
    return {
      isError: true,
      content: [{ type: "text", text: error.message || String(error) }],
    };
  }
});

async function main() {
  const transport = new StdioServerTransport();
  await server.connect(transport);
}

main().catch((error) => {
  console.error("Failed to start local-stitch-mcp:", error);
  process.exit(1);
});
