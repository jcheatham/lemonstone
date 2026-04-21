// isomorphic-git HTTP plugin that injects auth and enforces rate limits.
import type { GitHttpRequest, GitHttpResponse, HttpClient } from "isomorphic-git";
import { RateLimiter } from "./rate-limiter.ts";

async function collectBody(
  body: GitHttpRequest["body"]
): Promise<Uint8Array | undefined> {
  if (!body) return undefined;
  const chunks: Uint8Array[] = [];
  for await (const chunk of body) chunks.push(chunk);
  const total = chunks.reduce((n, c) => n + c.length, 0);
  const out = new Uint8Array(total);
  let offset = 0;
  for (const chunk of chunks) {
    out.set(chunk, offset);
    offset += chunk.length;
  }
  return out;
}

async function* bodyIterator(
  res: Response
): AsyncIterableIterator<Uint8Array> {
  if (!res.body) return;
  const reader = res.body.getReader();
  try {
    while (true) {
      const { done, value } = await reader.read();
      if (done) break;
      yield value;
    }
  } finally {
    reader.releaseLock();
  }
}

export function createGitHttpPlugin(
  rateLimiter: RateLimiter,
  onRateLimited?: (resumeAt: number) => void
): HttpClient {
  return {
    async request(req: GitHttpRequest): Promise<GitHttpResponse> {
      await rateLimiter.waitIfPaused(onRateLimited);
      await rateLimiter.throttleIfNeeded();

      const body = await collectBody(req.body);

      const res = await fetch(req.url, {
        method: req.method ?? "GET",
        headers: { ...req.headers },
        body,
        signal: req.signal as AbortSignal | undefined,
      });

      if (res.status === 401 || res.status === 403) {
        const bodyText = await res.clone().text().catch(() => "(unreadable)");
        console.error(`[git-http] ${res.status} on ${req.method} ${req.url}`);
        console.error(`[git-http] request headers:`, req.headers);
        console.error(`[git-http] response body:`, bodyText);
      }

      const headers: Record<string, string> = {};
      res.headers.forEach((value, key) => {
        headers[key] = value;
      });
      rateLimiter.consumeHeaders(headers);

      return {
        url: res.url,
        method: req.method,
        statusCode: res.status,
        statusMessage: res.statusText,
        headers,
        body: bodyIterator(res),
      };
    },
  };
}
