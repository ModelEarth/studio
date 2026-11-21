import { basePath, Env } from "./env";

// Static folders copied or linked into crew/site (see scripts/crew.mjs).
const STATIC_FOLDERS = ["/projects", "/localsite"];

/**
 * Everything outside /crew: the projects hub and localsite as static files, and the
 * ArtCraft webapp. Locally the webapp comes from its Vite dev server
 * (WEBAPP_DEV_ORIGIN); deployed, it is the built app in crew/site.
 */
export async function serveSite(request: Request, env: Env): Promise<Response> {
  const url = new URL(request.url);
  const isStatic = STATIC_FOLDERS.some((folder) => url.pathname === folder || url.pathname.startsWith(`${folder}/`));

  if (!isStatic && env.WEBAPP_DEV_ORIGIN && isLocalhost(url)) {
    return proxyToWebappDev(request, url, env.WEBAPP_DEV_ORIGIN);
  }

  const response = await env.ASSETS.fetch(request);
  if (isStatic && response.headers.get("content-type")?.startsWith("text/html")) {
    return injectCrewBase(response, basePath(env));
  }
  return response;
}

async function proxyToWebappDev(request: Request, url: URL, origin: string): Promise<Response> {
  const target = new URL(`${url.pathname}${url.search}`, origin);
  try {
    return await fetch(new Request(target, request), { redirect: "manual" });
  } catch {
    return new Response(`The ArtCraft webapp dev server isn't running on ${origin}. Start it with automation/webapp-dev.sh.`, {
      status: 502,
      headers: { "content-type": "text/plain; charset=utf-8" },
    });
  }
}

// The hub's Bid and Payment links read window.crewBaseUrl, so on this site they
// open crew pages on the same host.
function injectCrewBase(response: Response, base: string): Response {
  return new HTMLRewriter()
    .on("head", {
      element(head) {
        head.prepend(`<script>window.crewBaseUrl = ${JSON.stringify(base)};</script>`, { html: true });
      },
    })
    .transform(response);
}

function isLocalhost(url: URL): boolean {
  return url.hostname === "localhost" || url.hostname === "127.0.0.1" || url.hostname === "[::1]";
}
