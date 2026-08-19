// Generates lib/api-docs/openapi.json from the real route handlers in app/**/route.ts.
// Run with: node scripts/generate-openapi.mjs
// Curated descriptions/tags/schemas live in scripts/openapi-metadata.mjs and are merged here,
// so the spec always reflects the actual HTTP surface of the instance.

import { readdirSync, readFileSync, writeFileSync } from "node:fs";
import { join, dirname, relative, sep } from "node:path";
import { fileURLToPath } from "node:url";
import {
  TAGS,
  PUBLIC,
  PATH_TAGS,
  OP_META,
  SCHEMAS,
  QUERY_PARAMETERS,
  MANUAL_PATHS,
} from "./openapi-metadata.mjs";

const root = join(dirname(fileURLToPath(import.meta.url)), "..");
const appDir = join(root, "app");
const outFile = join(root, "lib", "api-docs", "openapi.json");
const version = JSON.parse(readFileSync(join(root, "package.json"), "utf8")).version ?? "0.1.0";

const METHOD_VERB = {
  GET: "Get",
  POST: "Post",
  PUT: "Update",
  PATCH: "Update",
  DELETE: "Delete",
};

function findRouteFiles(dir) {
  const out = [];
  for (const entry of readdirSync(dir, { withFileTypes: true })) {
    const p = join(dir, entry.name);
    if (entry.isDirectory()) {
      if (entry.name === "docs") continue;
      out.push(...findRouteFiles(p));
    } else if (entry.name === "route.ts" && entry.isFile) {
      out.push(p);
    }
  }
  return out;
}

function pathFromFile(file) {
  let rel = relative(appDir, file).split(sep).join("/");
  rel = rel.replace(/\/route\.ts$/, "");
  let path = "/" + rel;
  path = path.replace(/\[\.\.\.([^\]]+)\]/g, "{$1}");
  path = path.replace(/\[([^\]]+)\]/g, "{$1}");
  return path;
}

function leadingComments(src) {
  const lines = src.split("\n");
  const comments = [];
  for (const line of lines) {
    const t = line.trim();
    if (t.startsWith("//")) comments.push(t.replace(/^\/\/\s*/, ""));
    else if (t.startsWith("import ") || t.startsWith("import{")) break;
  }
  return comments
    .filter((c) => c.length > 0 && !/^(GET|POST|PUT|PATCH|DELETE|OPTIONS)\s+\//.test(c))
    .join(" ")
    .slice(0, 300);
}

function queryParams(src) {
  const names = new Set();
  const re = /\.get(?:All)?\(['"]([A-Za-z0-9_]+)['"]\)/g;
  let m;
  while ((m = re.exec(src))) names.add(m[1]);
  return [...names];
}

function methodsIn(src) {
  const methods = [];
  for (const name of ["GET", "POST", "PUT", "PATCH", "DELETE", "OPTIONS"]) {
    if (new RegExp(`export\\s+(?:async\\s+)?function\\s+${name}\\b`).test(src)) methods.push(name);
    else if (new RegExp(`export\\s*\\{[^}]*\\b${name}\\b[^}]*\\}\\s+from\\s+["']`).test(src)) methods.push(name);
  }
  return methods;
}

function hasBody(src) {
  return /request\.json\(\)|request\.formData\(|await request\.text\(\)/.test(src);
}

function isPublic(path, method) {
  if (PUBLIC.all.some((prefix) => path === prefix || path.startsWith(prefix + "/"))) return true;
  if (method === "GET" && PUBLIC.GET.includes(path)) return true;
  if (method === "POST" && PUBLIC.POST.includes(path)) return true;
  return false;
}

function tagFor(path) {
  for (const [prefix, tag] of PATH_TAGS) {
    if (path === prefix || path.startsWith(prefix + "/")) return tag;
  }
  return "Misc";
}

const files = findRouteFiles(appDir);
const paths = {};
const usedOpIds = new Set();

for (const [manualPath, manualOps] of Object.entries(MANUAL_PATHS)) {
  paths[manualPath] = {};
  for (const [method, op] of Object.entries(manualOps)) {
    paths[manualPath][method.toLowerCase()] = op;
  }
}

for (const file of files) {
  const src = readFileSync(file, "utf8");
  const path = pathFromFile(file);
  const methods = methodsIn(src);
  if (!methods.length) continue;

  const fileComments = leadingComments(src);
  const autoQuery = queryParams(src);
  const curated = OP_META[path] ?? {};

  for (const method of methods) {
    const meta = curated[method] ?? {};
    const security = meta.security !== undefined ? meta.security : isPublic(path, method) ? [] : [{ bearerAuth: [] }];
    const summary = meta.summary ?? `${METHOD_VERB[method] ?? method} ${path}`;
    const description = meta.description ?? (fileComments ? fileComments : summary);

    let baseOpId = meta.operationId;
    if (!baseOpId) {
      baseOpId = (method.toLowerCase() + path.replace(/\//g, "_").replace(/\{([^}]+)\}/g, "By$1").replace(/[^a-z0-9_]/gi, "")).replace(/_+/g, "_");
    }
    let operationId = baseOpId;
    let i = 2;
    while (usedOpIds.has(operationId)) operationId = `${baseOpId}_${i++}`;
    usedOpIds.add(operationId);

    const parameters = [];
    for (const param of path.matchAll(/\{([^}]+)\}/g)) {
      parameters.push({
        name: param[1],
        in: "path",
        required: true,
        schema: { type: "string" },
      });
    }
    const usedQuery = new Set();
    for (const q of autoQuery) {
      if (QUERY_PARAMETERS[q]) {
        parameters.push(QUERY_PARAMETERS[q]);
        usedQuery.add(q);
      }
    }
    for (const q of autoQuery) {
      if (!usedQuery.has(q)) {
        parameters.push({ name: q, in: "query", schema: { type: "string" } });
      }
    }
    if (meta.parameters) parameters.push(...meta.parameters);

    const op = {
      summary,
      ...(description !== summary ? { description } : {}),
      operationId,
      tags: meta.tags ?? [tagFor(path)],
      ...(parameters.length ? { parameters } : {}),
      security,
    };

    const requestBody = meta.requestBody;
    if (requestBody) {
      op.requestBody = requestBody;
    } else if (["POST", "PUT", "PATCH"].includes(method) && hasBody(src)) {
      op.requestBody = {
        required: false,
        content: {
          "application/json": { schema: { type: "object" } },
          "multipart/form-data": { schema: { type: "object" } },
        },
      };
    }

    const okStatus = method === "DELETE" ? "204" : "200";
    op.responses = {
      [okStatus]: { description: method === "DELETE" ? "Successfully deleted." : "Successful response." },
      ...(security.length
        ? { 401: { description: "Unauthorized. Missing or invalid access token.", content: { "application/json": { schema: { $ref: "#/components/schemas/Error" } } } } }
        : {}),
      ...(op.requestBody
        ? { 422: { description: "Validation error.", content: { "application/json": { schema: { $ref: "#/components/schemas/Error" } } } } }
        : {}),
    };

    paths[path] = paths[path] ?? {};
    paths[path][method.toLowerCase()] = op;
  }
}

const doc = {
  openapi: "3.0.3",
  info: {
    title: "CF ActivityPub API",
    version,
    description: `Mastodon-compatible ActivityPub API for this instance.\n\nAuthentication uses OAuth 2.0 bearer tokens obtained from \`POST /oauth/token\` (password grant). Public endpoints (instance metadata, public timelines, WebFinger, ActivityPub federation) do not require a token. Click **Authorize** and paste your access token to try authenticated endpoints.\n\nThis document is generated from the actual route handlers in \`app/**/route.ts\`.`,
  },
  servers: [{ url: "/" }],
  tags: TAGS,
  paths,
  components: {
    securitySchemes: {
      bearerAuth: {
        type: "http",
        scheme: "bearer",
        description: "OAuth access token. Obtain it from `POST /oauth/token` and pass as `Authorization: Bearer <token>`.",
      },
      oauth2: {
        type: "oauth2",
        flows: {
          password: {
            tokenUrl: "/oauth/token",
            scopes: {
              read: "Read access",
              write: "Write access",
              follow: "Follow accounts and manage relationships",
              push: "Manage push subscriptions",
            },
          },
        },
      },
    },
    schemas: SCHEMAS,
  },
};

writeFileSync(outFile, JSON.stringify(doc, null, 2) + "\n");

let total = 0;
for (const p of Object.keys(paths)) total += Object.keys(paths[p]).length;
console.log(`OpenAPI generated: ${Object.keys(paths).length} paths, ${total} operations → ${relative(root, outFile)}`);
