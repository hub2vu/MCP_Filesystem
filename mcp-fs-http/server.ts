// server.ts
// MCP Filesystem (readonly) — uses official SDK StreamableHTTPServerTransport
//
// ChatGPT의 openai-mcp 클라이언트는 MCP Streamable HTTP 프로토콜을 사용합니다.
// 공식 SDK의 transport가 SSE 응답 포맷·세션 관리·JSON-RPC 라우팅을 모두 처리합니다.
//
// Run (CMD):
//   cd C:\Users\hub2v\Desktop\MCP_TEST\mcp-fs-http
//   set ALLOWED_BASE=C:\Users\hub2v\Desktop\Beamforming
//   set PORT=3333
//   npm run dev
//
// Run (PowerShell):
//   $env:ALLOWED_BASE="C:\Users\hub2v\Desktop\Beamforming"
//   $env:PORT="3333"
//   npm run dev
//
// ngrok:
//   ngrok http 3333
//
// ChatGPT MCP URL:
//   https://<your-ngrok>.ngrok-free.dev/mcp

import express from "express";
import cors from "cors";
import path from "path";
import fs from "fs/promises";
import { randomUUID } from "crypto";
import { z } from "zod";

import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { StreamableHTTPServerTransport } from "@modelcontextprotocol/sdk/server/streamableHttp.js";
import { isInitializeRequest } from "@modelcontextprotocol/sdk/types.js";

// ====== Config ======
const PORT = Number(process.env.PORT ?? 3333);
const ALLOWED_BASE = process.env.ALLOWED_BASE;
if (!ALLOWED_BASE) {
  console.error("ERROR: ALLOWED_BASE env is required.");
  process.exit(1);
}
const allowedBaseAbs = path.resolve(ALLOWED_BASE);

// ====== Safety ======
process.on("uncaughtException", (err) => console.error("[uncaughtException]", err));
process.on("unhandledRejection", (err) => console.error("[unhandledRejection]", err));

// ====== Path helper ======
function safePath(raw: string | undefined): string {
  const trimmed = (raw ?? "").trim();
  // 빈 문자열이면 ALLOWED_BASE 자체를 반환
  if (!trimmed || trimmed === ".") return allowedBaseAbs;

  const abs = path.isAbsolute(trimmed)
    ? path.resolve(trimmed)
    : path.resolve(allowedBaseAbs, trimmed);

  const normAbs = path.normalize(abs);
  const normBase = path.normalize(allowedBaseAbs);

  if (!normAbs.startsWith(normBase + path.sep) && normAbs !== normBase) {
    throw new Error(`Path not allowed: ${normAbs} (allowed base: ${normBase})`);
  }
  return normAbs;
}

// ====== MCP Server factory ======
// 매 세션마다 새 McpServer를 만든다 (독립 세션 상태)
function createMcpServer(): McpServer {
  const mcp = new McpServer(
    { name: "local-filesystem-readonly", version: "2.0.0" },
    { capabilities: { tools: {} } },
  );

  // ── fs_list ──
  // raw Zod shape을 전달 (z.object()가 아닌 plain object)
  mcp.tool(
    "fs_list",
    `List files and directories. Paths relative to ALLOWED_BASE (${allowedBaseAbs}). Omit path to list root.`,
    { path: z.string().optional().describe("Directory path (relative or absolute)") } as any,
    async (args: any) => {
      const abs = safePath(args?.path);
      console.log(`  [fs_list] path="${args?.path ?? "(root)"}" → ${abs}`);

      const st = await fs.stat(abs);
      if (!st.isDirectory()) throw new Error(`Not a directory: ${abs}`);

      const entries = await fs.readdir(abs, { withFileTypes: true });
      const text = entries
        .map((e) => `${e.isDirectory() ? "DIR " : "FILE"}\t${e.name}`)
        .join("\n");

      console.log(`  [fs_list] → ${entries.length} entries`);
      return { content: [{ type: "text" as const, text }] };
    },
  );

  // ── fs_read ──
  mcp.tool(
    "fs_read",
    `Read a UTF-8 text file. Paths relative to ALLOWED_BASE (${allowedBaseAbs}).`,
    {
      path: z.string().describe("File path to read"),
      maxBytes: z.number().int().positive().optional().describe("Max bytes (default 1 MB)"),
    } as any,
    async (args: any) => {
      const abs = safePath(args?.path);
      console.log(`  [fs_read] path="${args?.path}" → ${abs}`);

      const st = await fs.stat(abs);
      if (!st.isFile()) throw new Error(`Not a file: ${abs}`);

      const limit = args?.maxBytes ?? 1024 * 1024;
      const buf = await fs.readFile(abs);
      const sliced = buf.subarray(0, Math.min(buf.length, limit));
      const text = sliced.toString("utf8");

      console.log(`  [fs_read] → ${text.length} chars`);
      return { content: [{ type: "text" as const, text }] };
    },
  );

  // ── read_file (alias) ──
  mcp.tool(
    "read_file",
    "Alias of fs_read — read a UTF-8 text file.",
    {
      path: z.string().describe("File path to read"),
      maxBytes: z.number().int().positive().optional(),
    } as any,
    async (args: any) => {
      const abs = safePath(args?.path);
      const st = await fs.stat(abs);
      if (!st.isFile()) throw new Error(`Not a file: ${abs}`);
      const limit = args?.maxBytes ?? 1024 * 1024;
      const buf = await fs.readFile(abs);
      const sliced = buf.subarray(0, Math.min(buf.length, limit));
      return { content: [{ type: "text" as const, text: sliced.toString("utf8") }] };
    },
  );

  return mcp;
}

// ====== Session management ======
type SessionEntry = {
  transport: StreamableHTTPServerTransport;
  mcp: McpServer;
};
const sessions = new Map<string, SessionEntry>();

function createSession(): { sessionId: string; entry: SessionEntry } {
  const sessionId = randomUUID();

  const transport = new StreamableHTTPServerTransport({
    sessionIdGenerator: () => sessionId,
  });

  const mcp = createMcpServer();
  void mcp.connect(transport);

  const entry: SessionEntry = { transport, mcp };
  sessions.set(sessionId, entry);

  console.log(`[session] CREATED ${sessionId}  (total=${sessions.size})`);
  return { sessionId, entry };
}

// ====== Express ======
const app = express();

app.use(
  cors({
    origin: true,
    credentials: true,
    // mcp-session-id 를 브라우저/프록시에서도 읽을 수 있게 노출
    exposedHeaders: ["mcp-session-id"],
  }),
);

app.use(express.json({ limit: "4mb" }));

// OAuth protected-resource metadata (noauth)
app.get("/.well-known/oauth-protected-resource", (req, res) => {
  const host = String(req.headers.host || "");
  const resource = `https://${host}`;
  res.json({
    resource,
    authorization_servers: [],
    scopes_supported: [],
    resource_documentation: resource,
  });
});

// Health
app.get(["/", "/health"], (_req, res) => res.status(200).send("ok"));

// ====== /mcp — Streamable HTTP transport ======
app.all("/mcp", async (req, res) => {
  try {
    const method = req.method;
    const headerSid = req.headers["mcp-session-id"] as string | undefined;
    let entry = headerSid ? sessions.get(headerSid) : undefined;

    console.log(
      `\n[${method} /mcp] sid=${headerSid ?? "(none)"} found=${!!entry}` +
        `  accept="${String(req.headers.accept ?? "").slice(0, 80)}"`,
    );

    // ── GET: SSE stream (server→client notifications 용) ──
    if (method === "GET") {
      if (!entry) {
        const created = createSession();
        entry = created.entry;
      }
      // SDK transport가 SSE 연결을 열고 keep-alive 처리
      return await entry.transport.handleRequest(req, res);
    }

    // ── POST: JSON-RPC request ──
    if (method === "POST") {
      const reqBody = req.body;

      // 디버그 로깅
      if (Array.isArray(reqBody)) {
        console.log(
          `  batch: [${reqBody.map((r: any) => `${r?.method}(id=${r?.id})`).join(", ")}]`,
        );
      } else {
        console.log(`  method=${reqBody?.method}  id=${reqBody?.id}`);
      }

      // 세션 없음 → initialize 가 아니면 거부
      if (!entry) {
        if (!isInitializeRequest(reqBody)) {
          console.log(`  → 400 (no session + not initialize)`);
          return res.status(400).json({
            jsonrpc: "2.0",
            error: {
              code: -32000,
              message: "Bad Request: no valid session. Send initialize first.",
            },
            id: reqBody?.id ?? null,
          });
        }
        const created = createSession();
        entry = created.entry;
      }

      // ★ SDK transport 가 SSE 응답 포맷·세션 헤더·메서드 라우팅 모두 처리
      return await entry.transport.handleRequest(req, res, reqBody);
    }

    // ── DELETE: session close ──
    if (method === "DELETE") {
      if (entry && headerSid) {
        await entry.transport.close();
        sessions.delete(headerSid);
        console.log(`[session] DELETED ${headerSid}`);
      }
      return res.status(200).send();
    }

    return res.status(405).send("Method Not Allowed");
  } catch (err: any) {
    console.error("[/mcp] UNHANDLED:", err?.stack || err);
    if (!res.headersSent) res.status(500).send("Internal Server Error");
  }
});

// Admin
app.post("/admin/clear-sessions", (_req, res) => {
  sessions.clear();
  res.status(200).send("cleared");
});

app.listen(PORT, "127.0.0.1", () => {
  console.log(`\n========================================`);
  console.log(`MCP (Streamable HTTP) running at http://127.0.0.1:${PORT}/mcp`);
  console.log(`ALLOWED_BASE = ${allowedBaseAbs}`);
  console.log(`========================================\n`);
});
