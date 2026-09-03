#!/usr/bin/env node
// Dependency-free build/validation for the static site.
// Checks per-page SEO invariants, valid JSON-LD, internal-link integrity,
// and sitemap ↔ file consistency. Exits non-zero on any error.

import { readFileSync, readdirSync, statSync, existsSync } from "node:fs";
import { join, relative, dirname } from "node:path";
import { fileURLToPath } from "node:url";

const ROOT = join(dirname(fileURLToPath(import.meta.url)), "..");
const PUB = join(ROOT, "public");

const errors = [];
const warnings = [];
const err = (f, m) => errors.push(`${f}: ${m}`);
const warn = (f, m) => warnings.push(`${f}: ${m}`);

// Collect all HTML files under public/.
function walk(dir) {
  const out = [];
  for (const name of readdirSync(dir)) {
    const p = join(dir, name);
    const s = statSync(p);
    if (s.isDirectory()) out.push(...walk(p));
    else if (name.endsWith(".html")) out.push(p);
  }
  return out;
}

const htmlFiles = walk(PUB);

// Map a site-absolute route to a file on disk (mirrors Cloudflare
// auto-trailing-slash static asset resolution for extensionless URLs).
function routeToFile(route) {
  let r = route.split("#")[0].split("?")[0];
  if (r === "/" || r === "") return join(PUB, "index.html");
  if (r.endsWith("/")) r = r.slice(0, -1);
  const direct = join(PUB, r);
  if (existsSync(direct) && statSync(direct).isFile()) return direct; // asset (css/js/img)
  const asHtml = join(PUB, r + ".html");
  if (existsSync(asHtml)) return asHtml;
  const asIndex = join(PUB, r, "index.html");
  if (existsSync(asIndex)) return asIndex;
  return null;
}

// Routes intentionally handled outside public/ (see _redirects).
const REDIRECTS = new Set(["/cms-0057f-compliance"]);

const countMatches = (s, re) => (s.match(re) || []).length;

for (const file of htmlFiles) {
  const rel = relative(ROOT, file);
  const html = readFileSync(file, "utf8");
  const is404 = file.endsWith("404.html");
  const noindex = /<meta[^>]+name=["']robots["'][^>]+noindex/i.test(html);

  // --- JSON-LD validity (all pages) ---
  const ldBlocks = html.match(
    /<script[^>]+type=["']application\/ld\+json["'][^>]*>([\s\S]*?)<\/script>/gi
  ) || [];
  for (const block of ldBlocks) {
    const json = block.replace(/^<script[^>]*>/i, "").replace(/<\/script>$/i, "").trim();
    try {
      JSON.parse(json);
    } catch (e) {
      err(rel, `invalid JSON-LD: ${e.message}`);
    }
  }

  // --- SEO invariants (skip the intentionally-minimal 404 / noindex pages) ---
  if (!is404 && !noindex) {
    const titles = countMatches(html, /<title>[\s\S]*?<\/title>/gi);
    if (titles !== 1) err(rel, `expected exactly 1 <title>, found ${titles}`);

    const h1s = countMatches(html, /<h1[\s>]/gi);
    if (h1s !== 1) err(rel, `expected exactly 1 <h1>, found ${h1s}`);

    if (!/<meta[^>]+name=["']description["'][^>]+content=/i.test(html))
      err(rel, "missing meta description");

    if (!/<link[^>]+rel=["']canonical["'][^>]+href=/i.test(html))
      err(rel, "missing canonical link");

    if (!/<meta[^>]+property=["']og:title["']/i.test(html))
      warn(rel, "missing og:title");
    if (!/<meta[^>]+name=["']twitter:card["']/i.test(html))
      warn(rel, "missing twitter:card");
  }

  // --- Internal link integrity ---
  const hrefs = [...html.matchAll(/href=["'](\/[^"'#][^"']*|\/)["']/gi)].map((m) => m[1]);
  for (const href of hrefs) {
    if (href.startsWith("//")) continue; // protocol-relative external
    if (REDIRECTS.has(href.split("#")[0])) continue;
    if (routeToFile(href) === null) err(rel, `broken internal link: ${href}`);
  }
}

// --- Sitemap consistency ---
const sitemapPath = join(PUB, "sitemap.xml");
if (!existsSync(sitemapPath)) {
  err("public/sitemap.xml", "missing sitemap");
} else {
  const sm = readFileSync(sitemapPath, "utf8");
  const locs = [...sm.matchAll(/<loc>([^<]+)<\/loc>/g)].map((m) => m[1]);
  const sitemapRoutes = new Set();
  for (const loc of locs) {
    const route = loc.replace(/^https?:\/\/cms-0057-f\.com/, "") || "/";
    sitemapRoutes.add(route);
    if (routeToFile(route) === null)
      err("public/sitemap.xml", `sitemap URL has no file: ${loc}`);
  }
  // Every indexable content page should appear in the sitemap.
  for (const file of htmlFiles) {
    const html = readFileSync(file, "utf8");
    if (file.endsWith("404.html")) continue;
    if (/<meta[^>]+name=["']robots["'][^>]+noindex/i.test(html)) continue;
    const relFromPub = relative(PUB, file).replace(/\\/g, "/");
    let route = "/" + relFromPub.replace(/\.html$/, "");
    if (route === "/index") route = "/";
    if (!sitemapRoutes.has(route))
      warn("public/sitemap.xml", `indexable page not in sitemap: ${route}`);
  }
}

// --- Report ---
console.log(`Checked ${htmlFiles.length} HTML pages.`);
if (warnings.length) {
  console.log(`\n${warnings.length} warning(s):`);
  for (const w of warnings) console.log(`  ⚠ ${w}`);
}
if (errors.length) {
  console.log(`\n${errors.length} error(s):`);
  for (const e of errors) console.log(`  ✗ ${e}`);
  process.exit(1);
}
console.log("\n✓ All checks passed.");
