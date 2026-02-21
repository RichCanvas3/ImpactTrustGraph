import { Hono } from "hono";
import { cors } from "hono/cors";

type Env = {
  IMPACT_AGENT_BACKEND_URL?: string; // e.g. https://impact-agent-backend.example.com
};

const app = new Hono<{ Bindings: Env }>();

app.use(
  "*",
  cors({
    origin: "*",
    allowMethods: ["GET", "POST", "OPTIONS"],
    exposeHeaders: ["Signature-Input", "Signature", "Date"],
  }),
);

app.get("/health", (c) => c.json({ status: "ok" }));

function getBackendUrl(c: any) {
  const raw = String(c.env?.IMPACT_AGENT_BACKEND_URL || "").trim().replace(/\/+$/, "");
  return raw || null;
}

async function proxyToBackend(c: any) {
  const backend = getBackendUrl(c);
  if (!backend) {
    return c.json(
      {
        success: false,
        error:
          "IMPACT_AGENT_BACKEND_URL is not set. Set it to your full impact-agent Node backend (same routes).",
      },
      501,
    );
  }

  const url = new URL(c.req.url);
  const target = `${backend}${url.pathname}${url.search}`;

  // Forward method/headers/body. Preserve Host for subdomain routing.
  const headers = new Headers(c.req.raw.headers);
  headers.set("host", url.host);
  headers.delete("content-length");

  const method = c.req.method.toUpperCase();
  const body = method === "GET" || method === "HEAD" ? undefined : await c.req.arrayBuffer();

  const res = await fetch(target, {
    method,
    headers,
    body,
  });

  const outHeaders = new Headers(res.headers);
  return new Response(res.body, { status: res.status, headers: outHeaders });
}

// Proxy everything (keeps Worker tiny; backend does the heavy lifting)
app.all("*", (c) => proxyToBackend(c));

export default app;

