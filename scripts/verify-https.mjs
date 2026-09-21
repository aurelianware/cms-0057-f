#!/usr/bin/env node
// Verifies HTTPS consolidation for every URL in the sitemap.
//
// For each sitemap entry this asserts:
//   1. the http:// URL answers 301 (not 200, not 302)
//   2. its Location is exactly the matching https:// URL -- same path, same port
//   3. following the redirect takes exactly ONE hop and lands on 200
//   4. the same holds with a query string attached, and the query survives intact
//
// Usage:
//   node scripts/verify-https.mjs                       # against production
//   node scripts/verify-https.mjs --local-dev           # against `wrangler dev`
//
// --local-dev points the run at a `wrangler dev` server on 127.0.0.1:8787 using
// a non-loopback Host header, so the Worker's redirect path is exercised rather
// than the loopback carve-out. It relaxes two assertions, and it is important to
// know exactly which:
//
//   * The follow-through (steps 3 and 4) is skipped. The dev server speaks plain
//     HTTP only, so the https:// target it names is not reachable locally.
//   * The Location scheme is NOT asserted. wrangler's dev proxy rewrites
//     redirect Location headers back to the local origin, so a Worker that
//     correctly answers `https://cms-0057-f.com:8787/x` is observed on the wire
//     as `http://cms-0057-f.com:8787/x`. Only the path and query are compared.
//
// So --local-dev proves the Worker issues a 301 and preserves path and query.
// It CANNOT prove the scheme is upgraded -- src/worker.mjs is covered for that
// by scripts/worker.test.mjs, and a production run of this script is the
// authoritative end-to-end check after deploy.
//
// Node built-ins only, matching scripts/validate.mjs.

import { readFileSync } from "node:fs";
import { execFileSync } from "node:child_process";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";

const ROOT = join(dirname(fileURLToPath(import.meta.url)), "..");

const CANONICAL_HOST = "cms-0057-f.com";
// Appended to one probe per URL to prove the query string survives the redirect.
const QUERY_PROBE = "verify=1&utm_source=cms-0057-f%20test&path=a%2Fb";

function parseArgs(argv) {
  const opts = {
    host: CANONICAL_HOST,
    sitemap: join(ROOT, "public", "sitemap.xml"),
    resolve: [],
    redirectOnly: false,
    ignoreScheme: false,
    timeout: "20",
  };
  for (let i = 0; i < argv.length; i++) {
    const arg = argv[i];
    if (arg === "--host") opts.host = argv[++i];
    else if (arg === "--sitemap") opts.sitemap = argv[++i];
    else if (arg === "--resolve") opts.resolve.push(argv[++i]);
    else if (arg === "--timeout") opts.timeout = argv[++i];
    else if (arg === "--redirect-only") opts.redirectOnly = true;
    else if (arg === "--local-dev") {
      opts.host = "cms-0057-f.com:8787";
      opts.resolve.push("cms-0057-f.com:8787:127.0.0.1");
      opts.redirectOnly = true;
      opts.ignoreScheme = true;
    }
    else {
      console.error(`Unknown argument: ${arg}`);
      process.exit(2);
    }
  }
  return opts;
}

const opts = parseArgs(process.argv.slice(2));

// curl, returning the requested -w fields. Network/DNS failures surface as a
// non-zero exit; report them as a failed check rather than crashing the run.
function curl(url, { follow = false, fields }) {
  const args = [
    "--silent",
    "--show-error",
    "--output",
    "/dev/null",
    "--max-time",
    opts.timeout,
    "--write-out",
    fields.map((f) => `%{${f}}`).join("\n"),
  ];
  if (follow) args.push("--location");
  for (const r of opts.resolve) args.push("--resolve", r);
  args.push(url);

  try {
    const out = execFileSync("curl", args, { encoding: "utf8" });
    const values = out.split("\n");
    return Object.fromEntries(fields.map((f, i) => [f, (values[i] ?? "").trim()]));
  } catch (e) {
    return { error: (e.stderr || e.message || String(e)).trim() };
  }
}

// --- Collect the URLs to check -------------------------------------------

const sitemap = readFileSync(opts.sitemap, "utf8");
const locs = [...sitemap.matchAll(/<loc>([^<]+)<\/loc>/g)].map((m) => m[1]);

if (locs.length === 0) {
  console.error(`No <loc> entries found in ${opts.sitemap}`);
  process.exit(2);
}

// A sitemap that still lists http:// URLs is itself a failure of this phase.
const nonHttps = locs.filter((l) => !l.startsWith("https://"));
const wrongHost = locs.filter(
  (l) => l.startsWith("https://") && new URL(l).host !== CANONICAL_HOST
);

const paths = locs.map((l) => new URL(l).pathname + new URL(l).search);

console.log(`Sitemap:  ${opts.sitemap}`);
console.log(`Host:     ${opts.host}`);
console.log(`URLs:     ${paths.length}`);
if (opts.resolve.length) console.log(`Resolve:  ${opts.resolve.join(", ")}`);
if (opts.redirectOnly) console.log(`Mode:     redirect-only (follow-through skipped)`);
if (opts.ignoreScheme)
  console.log(
    `          Location scheme NOT asserted -- wrangler dev rewrites it to the\n` +
      `          local origin. Path and query are compared; scheme is covered by\n` +
      `          scripts/worker.test.mjs and by a production run.`
  );
console.log("");

const failures = [];

if (nonHttps.length) {
  for (const l of nonHttps) failures.push(`sitemap lists a non-https URL: ${l}`);
}
if (wrongHost.length) {
  for (const l of wrongHost) failures.push(`sitemap lists an off-canonical host: ${l}`);
}

// --- Check each URL -------------------------------------------------------

const PAD = Math.max(...paths.map((p) => p.length)) + 2;

function check(pathAndQuery, { label }) {
  const httpUrl = `http://${opts.host}${pathAndQuery}`;
  const expected = `https://${opts.host}${pathAndQuery}`;
  const problems = [];

  const hop = curl(httpUrl, { fields: ["http_code", "redirect_url"] });
  if (hop.error) {
    problems.push(`request failed: ${hop.error}`);
  } else {
    if (hop.http_code !== "301") {
      problems.push(`expected 301, got ${hop.http_code}`);
    }
    const stripScheme = (u) => u.replace(/^https?:\/\//, "");
    const actual = hop.redirect_url || "";
    const matches = opts.ignoreScheme
      ? stripScheme(actual) === stripScheme(expected) && actual !== ""
      : actual === expected;
    if (!matches) {
      problems.push(
        `expected redirect to ${expected}, got ${actual || "(none)"}`
      );
    }
  }

  if (!opts.redirectOnly && problems.length === 0) {
    const followed = curl(httpUrl, {
      follow: true,
      fields: ["num_redirects", "http_code", "url_effective"],
    });
    if (followed.error) {
      problems.push(`follow-through failed: ${followed.error}`);
    } else {
      if (followed.num_redirects !== "1") {
        problems.push(`expected exactly 1 hop, took ${followed.num_redirects}`);
      }
      if (followed.http_code !== "200") {
        problems.push(`https target answered ${followed.http_code}, expected 200`);
      }
      if (followed.url_effective !== expected) {
        problems.push(`landed on ${followed.url_effective}, expected ${expected}`);
      }
    }
  }

  const status = problems.length === 0 ? "  PASS" : "  FAIL";
  console.log(`${status}  ${label.padEnd(PAD)} ${problems.join("; ")}`);
  for (const p of problems) failures.push(`${httpUrl}: ${p}`);
}

console.log("Path redirects");
for (const p of paths) check(p, { label: p });

console.log("");
console.log("Query-string preservation");
for (const p of paths) {
  const withQuery = `${p}${p.includes("?") ? "&" : "?"}${QUERY_PROBE}`;
  check(withQuery, { label: p });
}

// --- Report ---------------------------------------------------------------

console.log("");
if (failures.length) {
  console.log(`${failures.length} failure(s):`);
  for (const f of failures) console.log(`  x ${f}`);
  process.exit(1);
}
if (opts.ignoreScheme) {
  console.log(
    `All ${paths.length * 2} checks passed: every sitemap URL answers a 301 on ` +
      `http://, preserving path and query.\n` +
      `(Scheme upgrade not asserted in --local-dev mode -- see the header of this file.)`
  );
} else {
  console.log(
    `All ${paths.length * 2} checks passed: every sitemap URL 301s from http:// ` +
      `to its https:// equivalent in a single hop, with the query string intact.`
  );
}
