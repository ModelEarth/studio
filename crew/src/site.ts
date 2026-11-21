import { basePath, Env } from "./env";
import siteFolders from "../site-folders.json";

// Submodules served as static files at the site root (/engine/, /projects/, ...),
// copied or linked into crew/site by scripts/crew.mjs.
const STATIC_FOLDERS = siteFolders.map((folder) => `/${folder}`);

// Webapp pages that need an ArtCraft account: sign-in and sign-up, and the pages behind
// the webapp's RequireAuth. The home page, create- pages, pricing and welcome stay here.
const ACCOUNT_PATHS = /^\/(login|signup|set-password|forgot-password|video-editor|media|library|referrals|onboarding|checkout|checkout_success|checkout_cancel|portal_closed)(\/|$)/;

// Added to every page that doesn't already load them. Crew pages have them in html.ts.
export const LOCALSITE_CSS = `<link type="text/css" rel="stylesheet" href="/localsite/css/base.css" id="/localsite/css/base.css" />`;
export const LOCALSITE_JS = `<script type="text/javascript" src="/localsite/js/localsite.js?showheader=true&showsearch=true"></script>`;

/**
 * Everything outside /crew: the projects hub and localsite as static files, and the
 * ArtCraft webapp. Locally the webapp comes from its Vite dev server
 * (WEBAPP_DEV_ORIGIN); deployed, it is the built app in crew/site.
 *
 * With ARTCRAFT_ACCOUNTS_URL set, account pages open on that ArtCraft site instead,
 * since ArtCraft's API only accepts sign-ups from its own sites. Localhost is left
 * alone, because it uses the local backend.
 */
export async function serveSite(request: Request, env: Env): Promise<Response> {
  const url = new URL(request.url);
  const isStatic = STATIC_FOLDERS.some((folder) => url.pathname === folder || url.pathname.startsWith(`${folder}/`));
  const accounts = isLocalhost(url) ? null : accountsOrigin(env);

  if (accounts && !isStatic && ACCOUNT_PATHS.test(url.pathname)) {
    return Response.redirect(`${accounts}${url.pathname}${url.search}`, 302);
  }

  const pageRequest = withoutRevalidation(request);
  const response = !isStatic && env.WEBAPP_DEV_ORIGIN && isLocalhost(url)
    ? await proxyToWebappDev(pageRequest, url, env.WEBAPP_DEV_ORIGIN)
    : await env.ASSETS.fetch(pageRequest);
  if (!response.headers.get("content-type")?.startsWith("text/html")) return response;

  if (isStatic) {
    return addToPage(response, {
      headStart: `<script>window.crewBaseUrl = ${JSON.stringify(basePath(env))};</script>`,
      localsiteAtBodyEnd: true,
    });
  }
  return addToPage(response, {
    headStart: accounts ? accountScript(accounts) : "",
    headEnd: `<link rel="stylesheet" href="${basePath(env)}/css/studio.css" />\n${LAYOUT_SCRIPT}\n${THEME_SCRIPT}`,
  });
}

// Has the webapp follow localsite's light and dark modes (its dark mode toggle and
// Settings): data-theme="light" on <html> while localsite is light, which
// crew/css/studio.css gives light colors, and none while dark, the webapp's own look.
// localsite announces each change with a sitelookchange event. A saved light choice
// (the sitelook cookie) applies at once, so the page doesn't start dark.
const THEME_SCRIPT = `<script>(function () {
  var root = document.documentElement;
  function apply(dark) {
    if (dark) root.removeAttribute("data-theme");
    else root.setAttribute("data-theme", "light");
  }
  var saved = (document.cookie.match(/(?:^|; )sitelook=([^;]*)/) || [])[1];
  if (saved === "light" || (saved === "computer" && !matchMedia("(prefers-color-scheme: dark)").matches)) apply(false);
  document.addEventListener("sitelookchange", function (event) {
    apply(event.detail ? event.detail.dark : document.body.classList.contains("dark"));
  });
})();</script>`;

// Sets --studio-top and --studio-left (used by crew/css/studio.css) to where the webapp
// starts below localsite's header and right of its left nav, and keeps them current as
// those open, close and change size.
const LAYOUT_SCRIPT = `<script>(function () {
  var queued = false;
  function set(name, value) {
    var style = document.documentElement.style;
    if (style.getPropertyValue(name) !== value) style.setProperty(name, value);
  }
  function place() {
    queued = false;
    var root = document.getElementById("root");
    if (!root) return;
    var box = root.getBoundingClientRect();
    set("--studio-top", Math.max(0, Math.round(box.top + window.scrollY)) + "px");
    set("--studio-left", Math.max(0, Math.round(box.left + window.scrollX)) + "px");
  }
  function queue() {
    if (!queued) { queued = true; requestAnimationFrame(place); }
  }
  new MutationObserver(queue).observe(document.documentElement, { childList: true, subtree: true, attributes: true, attributeFilter: ["class"] });
  window.addEventListener("resize", queue);
  document.addEventListener("transitionend", queue);
})();</script>`;

// The pages are changed here on the way out, but keep the ETag of the file they came from,
// so a browser asking whether its copy is still current would be told yes (304) and keep a
// copy made before the Worker's additions changed. Page requests go out without those
// questions, and addToPage drops the file's ETag and date.
function withoutRevalidation(request: Request): Request {
  if (!request.headers.get("accept")?.includes("text/html")) return request;
  const page = new Request(request);
  page.headers.delete("if-none-match");
  page.headers.delete("if-modified-since");
  return page;
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

// Puts headStart at the top of <head> and headEnd at its end, and adds localsite's
// stylesheet and script unless the page already loads them. Webapp pages get them at
// the end of <head>. Submodule pages (localsiteAtBodyEnd) get them before </body>, after
// the whole page has been read, since some load localsite in <body> (project/index.html).
function addToPage(
  response: Response,
  { headStart = "", headEnd = "", localsiteAtBodyEnd = false }: { headStart?: string; headEnd?: string; localsiteAtBodyEnd?: boolean },
): Response {
  let hasLocalsiteCss = false;
  let hasLocalsiteJs = false;
  const missingLocalsite = () => [hasLocalsiteCss ? "" : LOCALSITE_CSS, hasLocalsiteJs ? "" : LOCALSITE_JS];
  const page = new Response(response.body, response);
  page.headers.delete("etag");
  page.headers.delete("last-modified");
  return new HTMLRewriter()
    .on('link[href*="localsite/css/base.css"]', { element() { hasLocalsiteCss = true; } })
    .on('script[src*="localsite/js/localsite.js"]', { element() { hasLocalsiteJs = true; } })
    .on("head", {
      element(head) {
        if (headStart) head.prepend(headStart, { html: true });
        head.onEndTag((end) => {
          const tags = [...(localsiteAtBodyEnd ? [] : missingLocalsite()), headEnd];
          end.before(tags.filter(Boolean).join("\n"), { html: true });
        });
      },
    })
    .on("body", {
      element(body) {
        if (!localsiteAtBodyEnd) return;
        body.onEndTag((end) => {
          end.before(missingLocalsite().filter(Boolean).join("\n"), { html: true });
        });
      },
    })
    .transform(page);
}

// The webapp moves between its pages without reloading, so those moves never reach this
// Worker. This script, which runs before the webapp, sends moves to account pages to
// ArtCraft, and hides "Continue with Google", which only works on ArtCraft's own sites.
// It also marks the webapp's "Couldn't load models" notice, which crew/css/studio.css hides:
// ArtCraft's API refuses this site, so that notice isn't a real outage here.
function accountScript(accounts: string): string {
  return `<script>(function () {
  var accounts = ${JSON.stringify(accounts)};
  var accountPaths = new RegExp(${JSON.stringify(ACCOUNT_PATHS.source)});
  function leave(target) {
    try {
      var url = new URL(target, location.href);
      if (url.origin !== location.origin || !accountPaths.test(url.pathname)) return false;
      location.assign(accounts + url.pathname + url.search + url.hash);
      return true;
    } catch (e) {
      return false;
    }
  }
  ["pushState", "replaceState"].forEach(function (name) {
    var original = history[name];
    history[name] = function (state, title, target) {
      if (target != null && leave(target)) return;
      return original.apply(this, arguments);
    };
  });
  var queued = false;
  function tidy() {
    queued = false;
    document.querySelectorAll("span").forEach(function (span) {
      var text = span.textContent.trim();
      if (text === "Continue with Google") {
        var button = span.closest(".group") || span.parentElement;
        if (!button) return;
        button.style.display = "none";
        var divider = button.previousElementSibling;
        if (divider && divider.textContent.trim().toLowerCase() === "or") divider.style.display = "none";
      } else if (text.indexOf("Couldn't load models") === 0) {
        var notice = span.closest(".glass") || span.parentElement;
        if (notice) notice.setAttribute("data-studio-notice", "models-outage");
      }
    });
  }
  new MutationObserver(function () {
    if (!queued) { queued = true; requestAnimationFrame(tidy); }
  }).observe(document.documentElement, { childList: true, subtree: true });
})();</script>`;
}

function accountsOrigin(env: Env): string | null {
  try {
    const url = new URL(env.ARTCRAFT_ACCOUNTS_URL ?? "");
    return url.protocol === "https:" ? url.origin : null;
  } catch {
    return null;
  }
}

function isLocalhost(url: URL): boolean {
  return url.hostname === "localhost" || url.hostname === "127.0.0.1" || url.hostname === "[::1]";
}
