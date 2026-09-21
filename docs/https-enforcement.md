# HTTPS enforcement for cms-0057-f.com

## The problem this solves

Google Search Console (3 months to 2026-09-19) showed the same page indexed
twice under two schemes:

| URL | Average position |
| --- | --- |
| `http://cms-0057-f.com/in-effect-2026` | 4.2 |
| `https://cms-0057-f.com/in-effect-2026` | 12.7 |

Google treats `http://` and `https://` as different URLs. Both were reachable,
so both were crawled, indexed, and ranked independently — splitting link equity
and internal signals across two copies of every page. The `http://` copy was
ranking *better*, which means the variant with no transport security was the one
being shown to searchers.

Root cause, confirmed against production on 2026-09-21:

```
$ curl -sSI http://cms-0057-f.com/in-effect-2026
HTTP/1.1 200 OK
server: cloudflare
```

Plain HTTP answered **200, not a redirect**. Nothing was consolidating the two
schemes. For contrast, `http://cloudhealthoffice.com/` correctly answers `301`,
so that zone already has edge HTTPS enforcement enabled and this one did not.

## The fix, in two independent layers

Both should be in place. They are not redundant — they fail in different ways.

### Layer 1 — `src/worker.mjs` (in this repository)

A Worker in front of the static-asset binding answers `301` to the matching
`https://` URL for any request whose scheme is `http:`, preserving path and
query string exactly.

This layer is in the repository because it is reviewable in a pull request,
diffable in history, and testable in CI (`scripts/worker.test.mjs`) and against
production (`scripts/verify-https.mjs`). A dashboard toggle is none of those
things.

`wrangler.jsonc` sets `assets.run_worker_first: true`. **This is load-bearing.**
Without it Cloudflare serves matching static assets directly and never invokes
the Worker, so the redirect would silently not run for exactly the page URLs
that are double-indexed. Do not remove it.

Requests to loopback hostnames (`localhost`, `127.0.0.1`, `[::1]`) are exempt so
`npm run preview` stays usable; production traffic never carries one.

### Layer 2 — Cloudflare zone settings (dashboard, manual)

These cannot be expressed in `wrangler.jsonc` and must be set by hand in the
Cloudflare dashboard for the `cms-0057-f.com` zone:

1. **SSL/TLS → Edge Certificates → Always Use HTTPS: On.**
   Redirects at the edge before a request reaches the Worker. This is the layer
   that protects against the Worker being misconfigured, the
   `run_worker_first` flag being dropped, or a route that bypasses the Worker.

2. **SSL/TLS → Overview → encryption mode: Full (strict).**
   Confirm it is not "Flexible". Flexible terminates TLS at the edge and talks
   plain HTTP to the origin, which is what makes an `http://` origin viable in
   the first place.

Neither is set from this repository, so neither is visible in code review.
Verify them with `npm run verify:https` after changing anything.

## HSTS — deliberately NOT enabled here

`Strict-Transport-Security` is the natural third layer and it is **not** part of
this change, on purpose.

An HSTS header with a one-year `max-age` is effectively irreversible for the
duration of that max-age: browsers that have seen it will refuse plain HTTP to
this host until it expires, and there is no way to reach those browsers to take
it back. Adding `includeSubDomains` extends that to every subdomain, including
any that do not have a certificate yet.

That is a deliberate operational commitment, not an SEO fix, and it is not
needed to resolve the duplicate-indexing problem — the 301 does that on its own.

If you do want it, the safe sequence is: ship the 301s, confirm every subdomain
serves valid HTTPS, then ramp `max-age` (300 → 86400 → 31536000) before
considering `includeSubDomains` or preload submission.

## Verifying

```bash
# Against production. Asserts, for all 13 sitemap URLs: http:// answers 301,
# the Location is the exact matching https:// URL, following it takes exactly
# one hop, that hop lands on 200, and the query string survives intact.
npm run verify:https

# Against a local `wrangler dev`. Proves the Worker issues the 301 and preserves
# path and query. It CANNOT prove the scheme upgrade -- wrangler's dev proxy
# rewrites redirect Location headers back to the local origin. See the header of
# scripts/verify-https.mjs.
npx wrangler dev &
node scripts/verify-https.mjs --local-dev
```

`npm run validate` additionally fails the build if any page reintroduces an
`http://` reference in an `href`, `src` or `content` attribute, or if
`sitemap.xml` lists a URL that is not an `https://cms-0057-f.com` URL. Both
checks run in CI.

## After deploying

1. Run `npm run verify:https` and confirm it exits 0.
2. In Search Console, re-submit `https://cms-0057-f.com/sitemap.xml`.
3. Expect the `http://` URLs to drop out of the index over several weeks as
   Google recrawls. Do not request removal of the `http://` URLs — the 301 is
   what transfers their ranking signals to the `https://` copies, and removing
   them outright would discard that.
