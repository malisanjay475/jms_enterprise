#!/usr/bin/env node
/**
 * Push local QC Supervisor design to Stitch API.
 *
 * Usage:
 *   node scripts/push-qc-design-to-stitch.js
 *
 * Required env:
 *   STITCH_API_BASE_URL
 *   STITCH_API_TOKEN
 *   STITCH_PUSH_PATH                 e.g. /designs/import
 *
 * Optional env:
 *   STITCH_AUTH_HEADER               default: Authorization
 *   STITCH_TOKEN_PREFIX              default: Bearer
 *   STITCH_PROJECT_ID
 *   STITCH_FILE_ID
 *   STITCH_COMPONENT_NAME            default: QCSupervisor Login
 *   STITCH_TARGET_FILE               default: PUBLIC/QCSupervisor.html
 *   STITCH_PUSH_METHOD               default: POST
 *   STITCH_PAYLOAD_MODE              default: html_css (or raw)
 *
 * Payload modes:
 * - html_css: sends structured payload with extracted <style> + <body> html
 * - raw: sends full file content in "content"
 */

const fs = require("fs/promises");
const path = require("path");

function readEnv(name, required = false, fallback = "") {
  const value = process.env[name] || fallback;
  if (required && !value) {
    throw new Error(`Missing required env: ${name}`);
  }
  return value;
}

function extractTagContent(source, tagName) {
  const regex = new RegExp(`<${tagName}[^>]*>([\\s\\S]*?)<\\/${tagName}>`, "i");
  const match = source.match(regex);
  return match ? match[1].trim() : "";
}

function extractAllStyleBlocks(source) {
  const regex = /<style[^>]*>([\s\S]*?)<\/style>/gi;
  const blocks = [];
  let match;
  while ((match = regex.exec(source)) !== null) {
    blocks.push(match[1].trim());
  }
  return blocks.join("\n\n");
}

async function main() {
  const baseUrl = readEnv("STITCH_API_BASE_URL", true).replace(/\/+$/, "");
  const token = readEnv("STITCH_API_TOKEN", true);
  const pushPath = readEnv("STITCH_PUSH_PATH", true);

  const authHeader = readEnv("STITCH_AUTH_HEADER", false, "Authorization");
  const tokenPrefix = readEnv("STITCH_TOKEN_PREFIX", false, "Bearer");
  const method = readEnv("STITCH_PUSH_METHOD", false, "POST").toUpperCase();
  const payloadMode = readEnv("STITCH_PAYLOAD_MODE", false, "html_css");
  const componentName = readEnv("STITCH_COMPONENT_NAME", false, "QCSupervisor Login");

  const projectId = readEnv("STITCH_PROJECT_ID");
  const fileId = readEnv("STITCH_FILE_ID");

  const targetRelative = readEnv(
    "STITCH_TARGET_FILE",
    false,
    "PUBLIC/QCSupervisor.html"
  );
  const targetFile = path.resolve(__dirname, "..", targetRelative);
  const source = await fs.readFile(targetFile, "utf8");

  let body;
  if (payloadMode === "raw") {
    body = {
      name: componentName,
      projectId: projectId || undefined,
      fileId: fileId || undefined,
      content: source,
      contentType: "text/html",
      sourcePath: targetRelative,
    };
  } else {
    const css = extractAllStyleBlocks(source);
    const htmlBody = extractTagContent(source, "body");
    body = {
      name: componentName,
      projectId: projectId || undefined,
      fileId: fileId || undefined,
      sourcePath: targetRelative,
      design: {
        format: "html_css",
        html: htmlBody,
        css,
      },
    };
  }

  const url = `${baseUrl}${pushPath.startsWith("/") ? pushPath : `/${pushPath}`}`;
  const response = await fetch(url, {
    method,
    headers: {
      "Content-Type": "application/json",
      [authHeader]: tokenPrefix ? `${tokenPrefix} ${token}` : token,
    },
    body: JSON.stringify(body),
  });

  const contentType = response.headers.get("content-type") || "";
  const isJson = contentType.includes("application/json");
  const payload = isJson ? await response.json() : await response.text();

  if (!response.ok) {
    throw new Error(
      `Stitch push failed (${response.status} ${response.statusText}): ${
        typeof payload === "string" ? payload : JSON.stringify(payload)
      }`
    );
  }

  console.log("QC design pushed to Stitch successfully.");
  console.log(typeof payload === "string" ? payload : JSON.stringify(payload, null, 2));
}

main().catch((err) => {
  console.error(err.message || err);
  process.exit(1);
});

