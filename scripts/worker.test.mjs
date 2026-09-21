#!/usr/bin/env node
// Unit tests for the HTTPS-redirect Worker (src/worker.mjs).
// Run with: node --test scripts/

import { test } from "node:test";
import assert from "node:assert/strict";

import worker, { httpsRedirectTarget } from "../src/worker.mjs";

test("redirects a plain-http page URL to https", () => {
  assert.equal(
    httpsRedirectTarget("http://cms-0057-f.com/in-effect-2026"),
    "https://cms-0057-f.com/in-effect-2026"
  );
});

test("preserves the path exactly, including nested paths and trailing slashes", () => {
  assert.equal(
    httpsRedirectTarget("http://cms-0057-f.com/guides/crd-dtr-pas-cms-0057-f"),
    "https://cms-0057-f.com/guides/crd-dtr-pas-cms-0057-f"
  );
  assert.equal(
    httpsRedirectTarget("http://cms-0057-f.com/guides/"),
    "https://cms-0057-f.com/guides/"
  );
  assert.equal(httpsRedirectTarget("http://cms-0057-f.com/"), "https://cms-0057-f.com/");
});

test("preserves the query string, including encoded characters", () => {
  assert.equal(
    httpsRedirectTarget("http://cms-0057-f.com/fact-sheet?utm_source=a%20b&x=1"),
    "https://cms-0057-f.com/fact-sheet?utm_source=a%20b&x=1"
  );
});

test("drops an explicit :80 so the target matches the canonical origin", () => {
  assert.equal(
    httpsRedirectTarget("http://cms-0057-f.com:80/fact-sheet"),
    "https://cms-0057-f.com/fact-sheet"
  );
});

test("preserves a non-default port, so local end-to-end runs work", () => {
  assert.equal(
    httpsRedirectTarget("http://cms-0057-f.com:8787/fact-sheet"),
    "https://cms-0057-f.com:8787/fact-sheet"
  );
});

test("leaves https requests alone", () => {
  assert.equal(httpsRedirectTarget("https://cms-0057-f.com/fact-sheet"), null);
});

test("leaves loopback hosts alone so `wrangler dev` stays usable", () => {
  assert.equal(httpsRedirectTarget("http://localhost:8787/fact-sheet"), null);
  assert.equal(httpsRedirectTarget("http://127.0.0.1:8787/fact-sheet"), null);
  assert.equal(httpsRedirectTarget("http://[::1]:8787/fact-sheet"), null);
});

test("returns null rather than throwing on an unparseable URL", () => {
  assert.equal(httpsRedirectTarget("not a url"), null);
});

test("fetch answers 301 with the Location header and no body", async () => {
  const assets = { fetch: async () => new Response("asset", { status: 200 }) };
  const response = await worker.fetch(
    new Request("http://cms-0057-f.com/fact-sheet?a=b"),
    { ASSETS: assets }
  );

  assert.equal(response.status, 301);
  assert.equal(response.headers.get("Location"), "https://cms-0057-f.com/fact-sheet?a=b");
  assert.equal(await response.text(), "");
});

test("fetch delegates https requests to the asset binding, unmodified", async () => {
  let seen = null;
  const assets = {
    fetch: async (request) => {
      seen = request.url;
      return new Response("asset", { status: 200 });
    },
  };
  const response = await worker.fetch(
    new Request("https://cms-0057-f.com/fact-sheet"),
    { ASSETS: assets }
  );

  assert.equal(response.status, 200);
  assert.equal(await response.text(), "asset");
  assert.equal(seen, "https://cms-0057-f.com/fact-sheet");
});
