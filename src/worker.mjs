/**
 * Entry point for the cms-0057-f.com static site.
 *
 * The site is served from Cloudflare Workers static assets. This Worker sits in
 * front of the asset binding for one reason: to 301 plain-HTTP requests to their
 * HTTPS equivalent.
 *
 * Why this exists in the repository rather than only as a zone setting:
 * Google Search Console showed both http://cms-0057-f.com/in-effect-2026 and
 * https://cms-0057-f.com/in-effect-2026 indexed as separate URLs, with the
 * http:// variant ranking higher. Plain HTTP was answering 200 instead of
 * redirecting, so the two schemes were competing for the same query. Expressing
 * the redirect here makes it reviewable, diffable, and testable by
 * `scripts/verify-https.mjs`.
 *
 * Cloudflare's "Always Use HTTPS" zone setting should ALSO be enabled, as
 * defense in depth — see docs/https-enforcement.md. The two are not redundant:
 * the zone setting redirects at the edge before a request ever reaches this
 * Worker, and this Worker covers the case where the zone setting is turned off
 * or a route bypasses it.
 *
 * `assets.run_worker_first` is set to `true` in wrangler.jsonc. Without it,
 * Cloudflare serves matching static assets directly and never invokes this
 * Worker, so the redirect would silently not run for exactly the URLs that
 * matter.
 */

// Requests to these hostnames are left alone so `wrangler dev` (which serves
// plain HTTP on loopback) stays usable for local preview. Production traffic
// never carries a loopback hostname. End-to-end tests exercise the real
// behavior by sending a non-loopback Host header at a local dev server; see
// scripts/verify-https.mjs.
const LOOPBACK_HOSTNAMES = new Set([
  "localhost",
  "127.0.0.1",
  "0.0.0.0",
  "[::1]",
  "::1",
]);

/**
 * Given a request URL, return the HTTPS URL it should be redirected to, or
 * `null` if the request should be served as-is.
 *
 * Path, query string and port are preserved exactly; only the scheme changes.
 * An explicit `:80` is dropped, since carrying it onto an https:// URL would
 * produce a target that does not match the canonical URL.
 *
 * @param {string} requestUrl
 * @returns {string | null}
 */
export function httpsRedirectTarget(requestUrl) {
  let url;
  try {
    url = new URL(requestUrl);
  } catch {
    return null;
  }

  if (url.protocol !== "http:") return null;
  if (LOOPBACK_HOSTNAMES.has(url.hostname)) return null;

  // Built by string construction rather than by assigning to `url.protocol`.
  // Both work (verified under workerd as well as Node), but spelling the target
  // out makes it obvious that scheme is the only thing that changes and that
  // path and query are carried across untouched.
  const host = url.port === "80" ? url.hostname : url.host;

  return `https://${host}${url.pathname}${url.search}`;
}

export default {
  /**
   * @param {Request} request
   * @param {{ ASSETS: { fetch: (request: Request) => Promise<Response> } }} env
   */
  async fetch(request, env) {
    const target = httpsRedirectTarget(request.url);

    if (target !== null) {
      return new Response(null, {
        status: 301,
        headers: { Location: target },
      });
    }

    return env.ASSETS.fetch(request);
  },
};
