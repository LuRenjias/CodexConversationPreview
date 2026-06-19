const crypto = require("crypto");
const fs = require("fs");
const http = require("http");
const os = require("os");
const path = require("path");
const { URL } = require("url");

const HOST = process.env.HOST || "127.0.0.1";
const PORT = Number(process.env.PORT || 5177);
const ACCESS_TOKEN = process.env.CODEX_PREVIEW_TOKEN || crypto.randomBytes(24).toString("base64url");
const SESSIONS_DIR =
  process.env.CODEX_SESSIONS_DIR || path.join(os.homedir(), ".codex", "sessions");
const SESSION_INDEX_FILE =
  process.env.CODEX_SESSION_INDEX_FILE || path.join(path.dirname(SESSIONS_DIR), "session_index.jsonl");
const PUBLIC_DIR = path.join(__dirname, "public");

function normalizeHostname(value) {
  const candidate = String(value || "").trim();
  if (!candidate) return "";

  try {
    return new URL(`http://${candidate}`).hostname.replace(/^\[|\]$/g, "").toLowerCase();
  } catch {
    return "";
  }
}

const ALLOWED_HOSTS = new Set(["127.0.0.1", "localhost", "::1"]);
for (const configuredHost of String(process.env.CODEX_PREVIEW_ALLOWED_HOSTS || "").split(",")) {
  const normalized = normalizeHostname(configuredHost);
  if (normalized) ALLOWED_HOSTS.add(normalized);
}
if (!["0.0.0.0", "::"].includes(HOST)) {
  const normalizedHost = normalizeHostname(HOST);
  if (normalizedHost) ALLOWED_HOSTS.add(normalizedHost);
}

const SECURITY_HEADERS = {
  "content-security-policy": "default-src 'self'; base-uri 'none'; connect-src 'self'; form-action 'none'; frame-ancestors 'none'; img-src 'self' data:; object-src 'none'; script-src 'self'; style-src 'self' 'unsafe-inline'",
  "cross-origin-resource-policy": "same-origin",
  "permissions-policy": "camera=(), microphone=(), geolocation=()",
  "referrer-policy": "no-referrer",
  "x-content-type-options": "nosniff",
  "x-frame-options": "DENY",
};

const MIME_TYPES = {
  ".html": "text/html; charset=utf-8",
  ".css": "text/css; charset=utf-8",
  ".js": "application/javascript; charset=utf-8",
  ".json": "application/json; charset=utf-8",
  ".svg": "image/svg+xml",
};

function isAllowedHost(req) {
  return ALLOWED_HOSTS.has(normalizeHostname(req.headers.host));
}

function requestAccessToken(req) {
  const authorization = String(req.headers.authorization || "");
  if (authorization.startsWith("Bearer ")) return authorization.slice(7);
  return String(req.headers["x-codex-preview-token"] || "");
}

function tokenMatches(candidate) {
  const expected = Buffer.from(ACCESS_TOKEN);
  const received = Buffer.from(String(candidate || ""));
  return expected.length === received.length && crypto.timingSafeEqual(expected, received);
}

function isAuthorized(req) {
  return tokenMatches(requestAccessToken(req));
}

function responseHeaders(headers = {}) {
  return { ...SECURITY_HEADERS, ...headers };
}

function walkJsonlFiles(root) {
  const files = [];
  const stack = [root];

  while (stack.length > 0) {
    const current = stack.pop();
    let entries;

    try {
      entries = fs.readdirSync(current, { withFileTypes: true });
    } catch {
      continue;
    }

    for (const entry of entries) {
      const fullPath = path.join(current, entry.name);

      if (entry.isDirectory()) {
        stack.push(fullPath);
      } else if (entry.isFile() && entry.name.endsWith(".jsonl")) {
        files.push(fullPath);
      }
    }
  }

  return files;
}

function readJsonl(filePath) {
  const rows = [];
  const errors = [];
  const raw = fs.readFileSync(filePath, "utf8");
  const lines = raw.split(/\r?\n/);

  lines.forEach((line, index) => {
    const trimmed = line.trim();
    if (!trimmed) return;

    try {
      rows.push(JSON.parse(trimmed));
    } catch (error) {
      errors.push({ line: index + 1, message: error.message });
    }
  });

  return { rows, errors };
}

function textFromContent(content) {
  if (content == null) return "";
  if (typeof content === "string") return content;
  if (!Array.isArray(content)) return formatValue(content);

  return content
    .map((part) => {
      if (typeof part === "string") return part;
      if (!part || typeof part !== "object") return "";
      if (typeof part.text === "string") return part.text;
      if (typeof part.input_text === "string") return part.input_text;
      if (typeof part.output_text === "string") return part.output_text;
      if (part.type === "image_url" || part.type === "input_image") return "[image]";
      return formatValue(part);
    })
    .filter(Boolean)
    .join("\n");
}

function formatValue(value) {
  if (value == null) return "";
  if (typeof value === "string") return value;
  try {
    return JSON.stringify(value, null, 2);
  } catch {
    return String(value);
  }
}

function compactWhitespace(text) {
  return String(text || "").replace(/\s+/g, " ").trim();
}

function isEnvironmentContext(text) {
  return compactWhitespace(text).startsWith("<environment_context>");
}

function stripConversationPreviewNoise(text) {
  return String(text || "")
    .replace(/<environment_context>[\s\S]*?<\/environment_context>/g, "")
    .trim();
}

function truncate(text, maxLength) {
  const clean = compactWhitespace(text);
  if (clean.length <= maxLength) return clean;
  return `${clean.slice(0, maxLength - 1)}...`;
}

function getSessionIdFromFile(filePath) {
  const base = path.basename(filePath, ".jsonl");
  const match = base.match(/([0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12})$/i);
  return match ? match[1] : base;
}

function loadSessionIndex() {
  const index = new Map();

  if (!fs.existsSync(SESSION_INDEX_FILE)) return index;

  const { rows } = readJsonl(SESSION_INDEX_FILE);
  for (const row of rows) {
    if (!row.id) continue;
    index.set(row.id, {
      title: row.thread_name || "",
      updatedAt: row.updated_at || "",
    });
  }

  return index;
}

function summarizeFile(filePath, sessionIndex = loadSessionIndex()) {
  const stat = fs.statSync(filePath);
  const { rows, errors } = readJsonl(filePath);
  let meta = {};
  let firstUser = "";
  let lastMessage = "";
  let messageCount = 0;
  let userMessageCount = 0;
  let assistantMessageCount = 0;
  let toolEventCount = 0;

  for (const row of rows) {
    const payload = row.payload || {};

    if (row.type === "session_meta") {
      meta = payload;
    }

    if (row.type !== "response_item") continue;

    if (payload.type === "message") {
      const text = stripConversationPreviewNoise(textFromContent(payload.content));
      if (!text) continue;

      messageCount += 1;
      lastMessage = text;

      if (payload.role === "user") {
        userMessageCount += 1;
        if (!firstUser && !isEnvironmentContext(text)) firstUser = text;
      } else if (payload.role === "assistant") {
        assistantMessageCount += 1;
      }
    } else if (payload.type === "function_call" || payload.type === "function_call_output") {
      toolEventCount += 1;
    }
  }

  const id = meta.id || getSessionIdFromFile(filePath);
  const indexEntry = sessionIndex.get(id) || {};
  const parentEntry = meta.parent_thread_id ? sessionIndex.get(meta.parent_thread_id) : null;
  const subagentName = meta.source?.subagent
    ? Object.values(meta.source.subagent).filter(Boolean).join(", ")
    : "";
  const indexedTitle =
    indexEntry.title ||
    (parentEntry?.title ? `${parentEntry.title} · ${subagentName || "subagent"}` : "");
  const startedAt = meta.timestamp || rows[0]?.timestamp || stat.birthtime.toISOString();
  const updatedAt = rows.at(-1)?.timestamp || stat.mtime.toISOString();
  const title = truncate(indexedTitle || `Untitled session ${id}`, 96);

  return {
    id,
    title,
    startedAt,
    updatedAt,
    isSubagent: Boolean(meta.parent_thread_id || meta.thread_source === "subagent" || meta.source?.subagent),
    cwd: meta.cwd || "",
    originator: meta.originator || "",
    cliVersion: meta.cli_version || "",
    filePath,
    relativePath: path.relative(SESSIONS_DIR, filePath),
    messageCount,
    userMessageCount,
    assistantMessageCount,
    toolEventCount,
    parseErrorCount: errors.length,
  };
}

function publicConversationSummary(summary) {
  return {
    id: summary.id,
    title: summary.title,
    startedAt: summary.startedAt,
    updatedAt: summary.updatedAt,
    workspace: summary.cwd ? path.basename(summary.cwd) : "",
    relativePath: summary.relativePath,
    messageCount: summary.messageCount,
    userMessageCount: summary.userMessageCount,
    assistantMessageCount: summary.assistantMessageCount,
    toolEventCount: summary.toolEventCount,
    parseErrorCount: summary.parseErrorCount,
    ...(summary.loadError ? { loadError: "Unable to read session" } : {}),
  };
}

function buildConversationItem(row, index) {
  const payload = row.payload || {};
  const timestamp = row.timestamp || payload.timestamp || null;

  if (row.type === "response_item" && payload.type === "message") {
    const content = stripConversationPreviewNoise(textFromContent(payload.content));
    if (!content) return null;

    return {
      id: `item-${index}`,
      kind: "message",
      role: payload.role || "message",
      title: payload.phase || "",
      timestamp,
      content,
      rawType: payload.type,
    };
  }

  if (row.type === "response_item" && payload.type === "function_call") {
    return {
      id: `item-${index}`,
      kind: "tool_call",
      role: "tool",
      title: `${payload.name || "tool"} call`,
      timestamp,
      content: formatValue(parseMaybeJson(payload.arguments)),
      rawType: payload.type,
      callId: payload.call_id || "",
    };
  }

  if (row.type === "response_item" && payload.type === "function_call_output") {
    return {
      id: `item-${index}`,
      kind: "tool_output",
      role: "tool",
      title: "tool output",
      timestamp,
      content: formatValue(parseMaybeJson(payload.output)),
      rawType: payload.type,
      callId: payload.call_id || "",
    };
  }

  if (row.type === "response_item" && payload.type === "reasoning") {
    const summary = textFromContent(payload.summary);
    if (!summary) return null;

    return {
      id: `item-${index}`,
      kind: "reasoning",
      role: "reasoning",
      title: "reasoning summary",
      timestamp,
      content: summary,
      rawType: payload.type,
    };
  }

  return null;
}

function parseMaybeJson(value) {
  if (typeof value !== "string") return value;

  try {
    return JSON.parse(value);
  } catch {
    return value;
  }
}

function getConversation(filePath) {
  const summary = summarizeFile(filePath);
  const { rows } = readJsonl(filePath);
  const items = rows
    .map((row, index) => buildConversationItem(row, index))
    .filter(Boolean);

  return {
    ...publicConversationSummary(summary),
    items,
  };
}

function listConversations() {
  if (!fs.existsSync(SESSIONS_DIR)) return [];

  const sessionIndex = loadSessionIndex();
  return walkJsonlFiles(SESSIONS_DIR)
    .map((filePath) => {
      try {
        const summary = summarizeFile(filePath, sessionIndex);
        return summary.isSubagent || /(?:^| · )guardian$/.test(summary.title) ? null : summary;
      } catch (error) {
        return {
          id: getSessionIdFromFile(filePath),
          title: path.basename(filePath),
          startedAt: "",
          updatedAt: "",
          cwd: "",
          originator: "",
          cliVersion: "",
          filePath,
          relativePath: path.relative(SESSIONS_DIR, filePath),
          messageCount: 0,
          userMessageCount: 0,
          assistantMessageCount: 0,
          toolEventCount: 0,
          parseErrorCount: 1,
          loadError: error.message,
        };
      }
    })
    .filter(Boolean)
    .sort((a, b) => String(b.updatedAt).localeCompare(String(a.updatedAt)));
}

function findConversationFile(id) {
  const decoded = decodeURIComponent(id);
  const conversations = listConversations();
  const match = conversations.find(
    (conversation) =>
      conversation.id === decoded ||
      conversation.relativePath === decoded ||
      path.basename(conversation.filePath, ".jsonl") === decoded,
  );

  return match?.filePath || null;
}

function sendJson(res, status, body) {
  const data = JSON.stringify(body);
  res.writeHead(status, responseHeaders({
    "content-type": "application/json; charset=utf-8",
    "cache-control": "no-store",
  }));
  res.end(data);
}

function sendStatic(req, res, pathname) {
  const requested = pathname === "/" ? "/index.html" : pathname;
  const normalized = path.normalize(requested).replace(/^(\.\.[/\\])+/, "");
  const filePath = path.join(PUBLIC_DIR, normalized);

  if (!filePath.startsWith(PUBLIC_DIR)) {
    res.writeHead(403);
    res.end("Forbidden");
    return;
  }

  fs.readFile(filePath, (error, data) => {
    if (error) {
      res.writeHead(404);
      res.end("Not found");
      return;
    }

    res.writeHead(200, responseHeaders({
      "content-type": MIME_TYPES[path.extname(filePath)] || "application/octet-stream",
      "cache-control": "no-store",
    }));
    res.end(data);
  });
}

function handleApi(req, res, url) {
  if (url.pathname === "/api/health") {
    sendJson(res, 200, {
      ok: true,
      ready: fs.existsSync(SESSIONS_DIR),
    });
    return;
  }

  if (url.pathname === "/api/conversations") {
    const limit = Number(url.searchParams.get("limit") || 0);
    const conversations = listConversations().map(publicConversationSummary);
    sendJson(res, 200, {
      sourceLabel: path.basename(SESSIONS_DIR),
      count: conversations.length,
      conversations: limit > 0 ? conversations.slice(0, limit) : conversations,
    });
    return;
  }

  const pathMatch = url.pathname.match(/^\/api\/conversations\/([^/]+)\/path$/);
  if (pathMatch) {
    const filePath = findConversationFile(pathMatch[1]);
    if (!filePath) {
      sendJson(res, 404, { error: "Conversation not found" });
      return;
    }
    sendJson(res, 200, { filePath });
    return;
  }

  const detailMatch = url.pathname.match(/^\/api\/conversations\/(.+)$/);
  if (detailMatch) {
    const filePath = findConversationFile(detailMatch[1]);

    if (!filePath) {
      sendJson(res, 404, { error: "Conversation not found" });
      return;
    }

    sendJson(res, 200, getConversation(filePath));
    return;
  }

  sendJson(res, 404, { error: "API route not found" });
}

const server = http.createServer((req, res) => {
  if (!isAllowedHost(req)) {
    sendJson(res, 403, { error: "Host not allowed" });
    return;
  }

  const url = new URL(req.url, `http://${req.headers.host}`);
  if (url.pathname.startsWith("/api/")) {
    if (req.method !== "GET") {
      sendJson(res, 405, { error: "Method not allowed" });
      return;
    }
    if (!isAuthorized(req)) {
      sendJson(res, 401, { error: "Unauthorized" });
      return;
    }

    try {
      handleApi(req, res, url);
    } catch (error) {
      console.error(error);
      sendJson(res, 500, { error: "Internal server error" });
    }
    return;
  }

  sendStatic(req, res, url.pathname);
});

server.listen(PORT, HOST, () => {
  const browserHost = ["0.0.0.0", "::"].includes(HOST) ? "127.0.0.1" : HOST;
  const urlHost = browserHost.includes(":") ? `[${browserHost}]` : browserHost;
  const accessUrl = `http://${urlHost}:${PORT}/#token=${encodeURIComponent(ACCESS_TOKEN)}`;
  console.log(`Codex Conversation Preview: ${accessUrl}`);
  console.log(`Allowed hosts: ${Array.from(ALLOWED_HOSTS).join(", ")}`);
});
