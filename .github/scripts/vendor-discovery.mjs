// Vendor discovery for enrich-external-references.yml — the part of the
// external-reference cycle that does NOT depend on Blakadder.
//
// Two jobs, both feeding the standing review PR (nothing here is ever
// written to `main` on its own except the search cache, see below):
//
//  1. Find an official manufacturer/product page for devices that don't
//     have one yet — whether or not the device is on Blakadder, and even
//     when Blakadder has the device but no usable `mlink`.
//  2. For devices that aren't on Blakadder at all, gather everything the
//     Blakadder "Add new device" form (zigbee.blakadder.com/new.html, a
//     Google Form) needs, so a human can submit it in a few clicks.
//
// Sources, in order of trust:
//   - Zigbee2MQTT's device library (zigbee-herdsman-converters, installed
//     from npm by the workflow): offline, deterministic. Gives the real
//     brand (incl. which white-label brand a Tuya `_TZ3000_…` string
//     belongs to), the retail model number, a description, and whether
//     Z2M supports the device at all.
//   - Blakadder's own data: other devices from the same vendor tell us
//     that vendor's website domain (via their `mlink`s).
//   - A hand-curated vendor-domain list (.github/vendor-domains.json).
//   - A web search API (Brave Search, only if BRAVE_SEARCH_API_KEY is set
//     as a repo secret) — finds product pages and shop listings.
//   - The vendor's own site, no key needed: Shopify / WooCommerce product
//     search endpoints and the sitemap.
//
// Every candidate URL is fetched and must actually mention the device's
// model (retail or Zigbee model string) before it's proposed — a search
// hit on the right domain is not enough on its own.
//
// The workflow runs this as its own step and reads the JSON it writes;
// it can also be run by hand for a dry run:
//   node .github/scripts/vendor-discovery.mjs --data data \
//     --blakadder /tmp/blakadder-zigbee/_zigbee --zhc /tmp/zhc \
//     --out /tmp/vendor-discovery.json [--refresh] [--no-network]
//
// Search cache: external-references-cache.json at the repo root records
// what was searched and when, so a push-triggered run only searches new
// devices, and the monthly run only re-searches entries older than
// CACHE_MAX_AGE_DAYS. Without it every run would spend search-API quota
// re-finding the same answers.

import fs from "node:fs";
import path from "node:path";
import { pathToFileURL } from "node:url";

export const BLAKADDER_FORM = {
  base: "https://docs.google.com/forms/d/e/1FAIpQLSdtOVidl6QjBtN57Bta1wRttLB_gBOgReDZPmtaANhjrwdfpQ/viewform",
  // Field IDs read from the live form's FB_PUBLIC_LOAD_DATA_ on 2026-10-25.
  // If Blakadder ever rebuilds the form these change; the review page then
  // still shows every value to copy by hand, only the pre-fill breaks.
  entries: {
    manufacturer: 1402769771,
    deviceName: 686642770,
    model: 2085911643,
    zigbeeId: 1792822153,
    category: 1087176243,
    vendorLink: 1013187941,
    manufacturerLink: 909726705,
    gateways: 2131627877,
    description: 1643524559,
    notes: 2090640393,
  },
  categories: ["cover", "dimmer", "hvac", "light", "plug", "remote", "sensor", "switch", "other"],
};

const CACHE_MAX_AGE_DAYS = 28;
const DEFAULT_QUERY_BUDGET = 150;
const USER_AGENT = "zigbee-capabilities-bot/1.0 (+https://github.com/hsolgaard/zigbee-capabilities)";

// Kept in step with RETAILER_DOMAINS in enrich-external-references.yml.
export const RETAILER_DOMAINS = [
  "amazon.", "aliexpress.", "alibaba.", "ebay.", "banggood.", "domadoo.",
  "idealo.", "walmart.", "homedepot.", "leroymerlin.", "castorama.",
  "conrad.", "bol.com", "bricodepot.", "manomano.", "otto.de", "kaufland.",
  "temu.", "wish.com", "newegg.", "bestbuy.", "target.com", "argos.",
  "lowes.com", "screwfix.", "toolstation.", "robbshop.", "vesternet.",
];
// Never a manufacturer page and never a sensible "where to buy" link either.
const IGNORE_DOMAINS = [
  "zigbee.blakadder.com", "zigbee2mqtt.io", "github.com", "reddit.com",
  "community.home-assistant.io", "home-assistant.io", "youtube.com",
  "facebook.com", "csa-iot.org", "zigbeealliance.org", "smarthomescene.com",
  "pinterest.", "twitter.com", "x.com", "instagram.com", "manua.ls", "manualslib.com",
];

export function norm(s) {
  return (s || "").toString().toLowerCase().trim().replace(/[^a-z0-9]+/g, "");
}
export function looksLikeTuyaManufacturerString(s) {
  return /^_[A-Z0-9]+_[a-z0-9]+$/i.test((s || "").trim());
}
export function domainOf(url) {
  try {
    return new URL(url).hostname.replace(/^www\./, "").toLowerCase();
  } catch (e) {
    return "";
  }
}
const domainIn = (d, list) => list.some((r) => d.includes(r));
export const isRetailerUrl = (url) => domainIn(domainOf(url), RETAILER_DOMAINS);
const isIgnoredUrl = (url) => domainIn(domainOf(url), IGNORE_DOMAINS);
function isBareHomepage(url) {
  try {
    const u = new URL(url);
    return (u.pathname === "" || u.pathname === "/") && !u.search;
  } catch (e) {
    return true;
  }
}
// A vendor's own product page that is also a shop listing (Shopify,
// WooCommerce and most shop builders) — good enough as Blakadder's
// required "where it can be bought" link, so no retailer is needed.
// A fetched page is a shop listing if it has a cart button or schema.org
// price markup — more reliable than the URL, since e.g. innr.com uses
// /product/ for plain information pages.
export function htmlLooksLikeShop(html) {
  return /add[ _-]?to[ _-]?(cart|basket|bag)|\/cart\/add|"priceCurrency"|itemprop=["']price["']|product:price:amount/i.test(html || "");
}
// URL-only fallback when a page couldn't be fetched.
export function looksLikeShopPage(url) {
  try {
    return /\/(products?|shop|store|buy)\//i.test(new URL(url).pathname);
  } catch (e) {
    return false;
  }
}
function sameSite(url, domain) {
  const d = domainOf(url);
  const base = domain.replace(/^www\./, "");
  return d === base || d.endsWith("." + base);
}
function domainLooksLikeVendor(url, brand) {
  const host = domainOf(url).replace(/\.[a-z.]+$/, "").replace(/[^a-z0-9]/g, "");
  const v = norm(brand);
  if (!host || v.length < 3) return false;
  return host.includes(v) || (host.length >= 4 && v.includes(host));
}

// --- Zigbee2MQTT device library -------------------------------------------

let zhcModule = null;
async function loadZhc(zhcPath) {
  if (zhcModule || !zhcPath) return zhcModule;
  const entry = path.join(zhcPath, "node_modules", "zigbee-herdsman-converters", "dist", "index.js");
  if (!fs.existsSync(entry)) return null;
  zhcModule = await import(pathToFileURL(entry).href);
  if (zhcModule.setLogger) {
    const quiet = () => {};
    zhcModule.setLogger({ debug: quiet, info: quiet, warning: quiet, error: quiet });
  }
  return zhcModule;
}

// What Z2M knows about this device. `brand` is the most specific vendor
// we can name: a white-label entry whose fingerprint lists our exact
// Tuya manufacturer string beats the definition's own vendor, and the
// bare word "Tuya" is reported as generic (brandIsGeneric) because it
// says nothing about who actually sells the thing.
export async function z2mIdentity(zhcPath, manufacturer, model) {
  const zhc = await loadZhc(zhcPath);
  if (!zhc || !model) return null;
  let def = null;
  try {
    def = await zhc.findDefinition(
      { modelID: model, manufacturerName: manufacturer || undefined, endpoints: [], getEndpoint: () => undefined, type: "Router" },
      false
    );
  } catch (e) {
    def = null;
  }
  if (!def || def.generated) return null;
  let brand = def.vendor;
  let retailModel = def.model;
  let description = def.description;
  for (const wl of def.whiteLabel || []) {
    const fps = wl.fingerprint || [];
    const hit = fps.some(
      (fp) => fp.manufacturerName && manufacturer && fp.manufacturerName.toLowerCase() === manufacturer.toLowerCase() && (!fp.modelID || fp.modelID === model)
    );
    if (hit) {
      brand = wl.vendor || brand;
      retailModel = wl.model || retailModel;
      description = wl.description || description;
      break;
    }
  }
  // Z2M uses the Zigbee manufacturer string itself as `model` for some
  // Tuya white-labels — that's not a retail model number.
  if (looksLikeTuyaManufacturerString(retailModel)) retailModel = null;
  return {
    brand,
    brandIsGeneric: norm(brand) === "tuya",
    retailModel,
    description,
    z2mModel: def.model,
    z2mVendor: def.vendor,
  };
}

// --- Vendor domains ---------------------------------------------------------

function parseFrontmatter(raw) {
  const m = raw.match(/^---\r?\n([\s\S]*?)\r?\n---/);
  if (!m) return null;
  const out = {};
  for (const line of m[1].split(/\r?\n/)) {
    const kv = line.match(/^([A-Za-z0-9_]+):\s*(.*)$/);
    if (kv) out[kv[1]] = kv[2].trim().replace(/^['"]|['"]$/g, "");
  }
  return out;
}

// vendor (normalized) -> most common non-retailer mlink domain across all
// of that vendor's Blakadder pages. Needs at least 2 pages agreeing, so a
// single odd mlink can't define a vendor's website.
export function vendorDomainsFromBlakadder(dir) {
  const counts = new Map();
  if (!dir || !fs.existsSync(dir)) return new Map();
  for (const f of fs.readdirSync(dir)) {
    if (!f.endsWith(".md")) continue;
    const fm = parseFrontmatter(fs.readFileSync(path.join(dir, f), "utf8"));
    if (!fm || !fm.vendor || !fm.mlink || isRetailerUrl(fm.mlink) || isIgnoredUrl(fm.mlink)) continue;
    const v = norm(fm.vendor);
    const d = domainOf(fm.mlink);
    if (!v || !d) continue;
    if (!counts.has(v)) counts.set(v, new Map());
    const m = counts.get(v);
    m.set(d, (m.get(d) || 0) + 1);
  }
  const out = new Map();
  for (const [v, m] of counts) {
    const [best] = [...m.entries()].sort((a, b) => b[1] - a[1]);
    if (best && best[1] >= 2) out.set(v, best[0]);
  }
  return out;
}

function vendorDomainsFor(brands, curated, fromBlakadder) {
  const out = [];
  for (const b of brands) {
    const n = norm(b);
    if (!n) continue;
    for (const d of curated[n] || []) if (!out.includes(d)) out.push(d);
    const bd = fromBlakadder.get(n);
    if (bd && !out.includes(bd)) out.push(bd);
  }
  return out;
}

// --- HTTP helpers -------------------------------------------------------------

function makeHttp(fetchImpl, { allowNetwork }) {
  const robotsCache = new Map();
  async function get(url, { accept, maxBytes = 3_000_000, timeoutMs = 15000 } = {}) {
    if (!allowNetwork) return null;
    try {
      const res = await fetchImpl(url, {
        redirect: "follow",
        headers: { "user-agent": USER_AGENT, accept: accept || "text/html,application/xhtml+xml,application/json,application/xml;q=0.9,*/*;q=0.8" },
        signal: AbortSignal.timeout(timeoutMs),
      });
      if (!res.ok) return { status: res.status, url: res.url || url, text: "" };
      const buf = await res.arrayBuffer();
      const text = Buffer.from(buf.byteLength > maxBytes ? buf.slice(0, maxBytes) : buf).toString("utf8");
      return { status: res.status, url: res.url || url, text };
    } catch (e) {
      return null;
    }
  }
  // Minimal robots.txt check (User-agent: * group, Disallow prefixes only).
  async function allowedByRobots(url) {
    let u;
    try {
      u = new URL(url);
    } catch (e) {
      return false;
    }
    const origin = u.origin;
    if (!robotsCache.has(origin)) {
      const r = await get(`${origin}/robots.txt`, { accept: "text/plain", maxBytes: 300_000 });
      const rules = { disallow: [], sitemaps: [] };
      if (r && r.text) {
        let inStar = false;
        for (const raw of r.text.split(/\r?\n/)) {
          const line = raw.replace(/#.*/, "").trim();
          const m = line.match(/^([A-Za-z-]+)\s*:\s*(.*)$/);
          if (!m) continue;
          const key = m[1].toLowerCase();
          if (key === "user-agent") inStar = m[2].trim() === "*";
          else if (key === "disallow" && inStar && m[2].trim()) rules.disallow.push(m[2].trim());
          else if (key === "sitemap") rules.sitemaps.push(m[2].trim());
        }
      }
      robotsCache.set(origin, rules);
    }
    const rules = robotsCache.get(origin);
    const p = u.pathname + u.search;
    return !rules.disallow.some((d) => !d.includes("*") && p.startsWith(d));
  }
  const sitemapsFor = (origin) => (robotsCache.get(origin) || { sitemaps: [] }).sitemaps;
  return { get, allowedByRobots, sitemapsFor };
}

function htmlToText(html) {
  return html
    .replace(/<script[\s\S]*?<\/script>/gi, " ")
    .replace(/<style[\s\S]*?<\/style>/gi, " ")
    .replace(/<[^>]+>/g, " ")
    .replace(/&nbsp;/g, " ")
    .replace(/&amp;/g, "&")
    .replace(/\s+/g, " ");
}
export function pageTitle(html, brand) {
  const og = html.match(/<meta[^>]+property=["']og:title["'][^>]+content=["']([^"']+)["']/i) ||
    html.match(/<meta[^>]+content=["']([^"']+)["'][^>]+property=["']og:title["']/i);
  const t = og ? og[1] : (html.match(/<title[^>]*>([\s\S]*?)<\/title>/i) || [])[1];
  if (!t) return null;
  let title = t.replace(/&amp;/g, "&").replace(/&#39;|&rsquo;/g, "'").replace(/&quot;/g, '"').replace(/\s+/g, " ").trim();
  // Drop a trailing " | Brand" / " – Brand Store" site-name suffix.
  const parts = title.split(/\s+[|–—-]\s+/);
  if (parts.length > 1 && brand && norm(parts[parts.length - 1]).includes(norm(brand).slice(0, 5))) parts.pop();
  title = parts.join(" - ").trim();
  return title.length >= 3 && title.length <= 120 ? title : null;
}

// The tokens a real product page for this device must mention. Short
// tokens (< 4 chars after normalizing) are too likely to match by
// accident and are dropped.
function evidenceTokens(identity, model) {
  const toks = [model, identity && identity.retailModel, identity && identity.z2mModel]
    .map(norm)
    .filter((t) => t.length >= 4);
  return [...new Set(toks)];
}

async function verifyPage(http, url, tokens, brand) {
  if (!tokens.length) return null;
  if (!(await http.allowedByRobots(url))) return null;
  const r = await http.get(url);
  if (!r || r.status >= 400 || !r.text) return null;
  const text = norm(htmlToText(r.text));
  const hit = tokens.find((t) => text.includes(t));
  if (!hit) return null;
  return { url: r.url || url, title: pageTitle(r.text, brand), shop: htmlLooksLikeShop(r.text), evidence: `page mentions "${hit}"` };
}

// --- Search sources -------------------------------------------------------------

async function braveSearch(http, fetchImpl, key, query) {
  try {
    const res = await fetchImpl(
      `https://api.search.brave.com/res/v1/web/search?count=10&q=${encodeURIComponent(query)}`,
      { headers: { accept: "application/json", "x-subscription-token": key }, signal: AbortSignal.timeout(15000) }
    );
    if (!res.ok) return { ok: false, status: res.status, results: [] };
    const j = await res.json();
    return {
      ok: true,
      results: ((j.web && j.web.results) || []).map((r) => ({ url: r.url, title: r.title || "", snippet: r.description || "" })),
    };
  } catch (e) {
    return { ok: false, results: [] };
  }
}

async function shopSearch(http, domain, query) {
  const origin = `https://${domain}`;
  const out = [];
  // Shopify predictive search.
  const s = await http.get(`${origin}/search/suggest.json?q=${encodeURIComponent(query)}&resources[type]=product&resources[limit]=5`, { accept: "application/json" });
  if (s && s.text && s.text.trim().startsWith("{")) {
    try {
      const j = JSON.parse(s.text);
      for (const p of (j.resources && j.resources.results && j.resources.results.products) || []) {
        if (p.url) out.push(new URL(p.url, origin).href.replace(/\?_pos=.*$/, ""));
      }
    } catch (e) {}
  }
  // WooCommerce Store API.
  if (!out.length) {
    const w = await http.get(`${origin}/wp-json/wc/store/products?per_page=5&search=${encodeURIComponent(query)}`, { accept: "application/json" });
    if (w && w.text && w.text.trim().startsWith("[")) {
      try {
        for (const p of JSON.parse(w.text)) if (p.permalink) out.push(p.permalink);
      } catch (e) {}
    }
  }
  return out;
}

// All page URLs from a vendor's sitemap(s), fetched once per domain per
// run (several devices from the same vendor share it) and capped, so a
// huge multi-country sitemap like IKEA's can't blow up the run.
const sitemapCache = new Map();
async function sitemapUrls(http, domain) {
  if (sitemapCache.has(domain)) return sitemapCache.get(domain);
  const origin = `https://${domain}`;
  await http.allowedByRobots(`${origin}/`); // populates sitemap list from robots.txt
  const queue = [...http.sitemapsFor(origin), `${origin}/sitemap.xml`];
  const seen = new Set();
  const urls = [];
  let fetched = 0;
  while (queue.length && fetched < 8 && urls.length < 200_000) {
    const sm = queue.shift();
    if (seen.has(sm)) continue;
    seen.add(sm);
    const r = await http.get(sm, { accept: "application/xml,text/xml", maxBytes: 8_000_000 });
    fetched++;
    if (!r || !r.text) continue;
    const locs = [...r.text.matchAll(/<loc>\s*([^<\s]+)\s*<\/loc>/gi)].map((m) => m[1].replace(/&amp;/g, "&"));
    if (/<sitemapindex/i.test(r.text)) {
      // Product sitemaps first; English ones before other locales.
      const score = (u) => (/product/i.test(u) ? 0 : 2) + (/\/(en|gb|uk|us)[/_-]|[_-]en\b/i.test(u) ? 0 : 1);
      queue.push(...locs.sort((a, b) => score(a) - score(b)).slice(0, 10));
      continue;
    }
    urls.push(...locs);
  }
  sitemapCache.set(domain, urls);
  return urls;
}

async function sitemapSearch(http, domain, tokens) {
  const hits = [];
  for (const loc of await sitemapUrls(http, domain)) {
    let p;
    try {
      p = norm(decodeURIComponent(new URL(loc).pathname));
    } catch (e) {
      continue;
    }
    if (tokens.some((t) => p.includes(t))) hits.push(loc);
    if (hits.length >= 5) break;
  }
  return hits;
}

// --- Category / gateways --------------------------------------------------------

const DEVICE_TYPE_CATEGORY = {
  "0x0000": "switch", "0x0001": "switch", "0x0002": "switch", "0x0103": "switch", "0x0104": "switch", "0x0105": "remote",
  "0x0006": "remote", "0x0820": "remote", "0x0810": "remote", "0x0830": "remote", "0x0840": "remote",
  "0x0009": "plug", "0x0051": "plug", "0x010a": "plug",
  "0x0100": "light", "0x0101": "light", "0x0102": "light", "0x010c": "light", "0x010d": "light", "0x0210": "light", "0x0220": "light",
  "0x0106": "sensor", "0x0107": "sensor", "0x0302": "sensor", "0x0402": "sensor", "0x0307": "sensor", "0x0305": "sensor",
  "0x0300": "hvac", "0x0301": "hvac", "0x0303": "hvac",
  "0x0202": "cover", "0x0203": "cover",
  "0x0008": "other",
};
const KEYWORD_CATEGORY = [
  [/\b(dimmer|dimming)\b/i, "dimmer"],
  [/\b(plug|socket|outlet)\b/i, "plug"],
  [/\b(curtain|blind|shutter|roller|cover|garage door opener)\b/i, "cover"],
  [/\b(thermostat|radiator|trv|valve|heating|hvac|air ?con)\b/i, "hvac"],
  [/\b(remote|button|scene switch|wireless switch|knob|controller)\b/i, "remote"],
  [/\bfan\b/i, "other"], // Blakadder has no fan category
  [/\b(sensor|detector|alarm|leak|motion|presence|contact)\b/i, "sensor"],
  [/\b(bulb|light|lamp|led|strip|panel|spot|downlight)\b/i, "light"],
  [/\b(switch|relay|module)\b/i, "switch"],
];
export function guessCategory(texts, deviceTypes) {
  for (const t of texts.filter(Boolean)) {
    for (const [re, cat] of KEYWORD_CATEGORY) if (re.test(t)) return cat;
  }
  for (const dt of deviceTypes) {
    const c = DEVICE_TYPE_CATEGORY[(dt || "").toLowerCase()];
    if (c) return c;
  }
  return null;
}

export function prefillUrl(fields) {
  const e = BLAKADDER_FORM.entries;
  const params = new URLSearchParams({ usp: "pp_url" });
  const add = (id, v) => {
    if (v) params.append(`entry.${id}`, v);
  };
  add(e.manufacturer, fields.manufacturer);
  add(e.deviceName, fields.deviceName);
  add(e.model, fields.model);
  add(e.zigbeeId, fields.zigbeeId);
  add(e.category, fields.category);
  add(e.vendorLink, fields.vendorLink);
  add(e.manufacturerLink, fields.manufacturerLink);
  for (const g of fields.gateways || []) add(e.gateways, g);
  add(e.description, fields.description);
  add(e.notes, fields.notes);
  return `${BLAKADDER_FORM.base}?${params.toString()}`;
}

// --- Main ---------------------------------------------------------------------

function walkDataFiles(dir) {
  let out = [];
  for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
    const full = path.join(dir, entry.name);
    if (entry.isDirectory()) out = out.concat(walkDataFiles(full));
    else if (entry.isFile() && entry.name.endsWith(".json") && !entry.name.startsWith("_") && entry.name !== "index.json" && entry.name !== "unknown-capabilities.json") out.push(full);
  }
  return out.sort();
}

function daysSince(iso, today) {
  const t = Date.parse(iso);
  return Number.isFinite(t) ? (Date.parse(today) - t) / 86400000 : Infinity;
}

export async function runDiscovery(opts) {
  const {
    dataDir = "data",
    blakadderDir = null,
    zhcPath = null,
    curatedDomainsPath = ".github/vendor-domains.json",
    cachePath = "external-references-cache.json",
    searchKey = process.env.BRAVE_SEARCH_API_KEY || "",
    queryBudget = DEFAULT_QUERY_BUDGET,
    refresh = false,
    allowNetwork = true,
    fetchImpl = globalThis.fetch,
    today = new Date().toISOString().slice(0, 10),
    log = console.log,
  } = opts || {};

  const http = makeHttp(fetchImpl, { allowNetwork });
  const curated = {};
  if (fs.existsSync(curatedDomainsPath)) {
    const raw = JSON.parse(fs.readFileSync(curatedDomainsPath, "utf8"));
    for (const [k, v] of Object.entries(raw.vendors || {})) curated[norm(k)] = Array.isArray(v) ? v : [v];
  }
  const fromBlakadder = vendorDomainsFromBlakadder(blakadderDir);
  const cache = fs.existsSync(cachePath) ? JSON.parse(fs.readFileSync(cachePath, "utf8")) : { devices: {} };
  cache.devices = cache.devices || {};
  let cacheChanged = false;
  let queriesLeft = searchKey ? queryBudget : 0;
  let searchApiFailures = 0;
  const stats = { devices: 0, searched: 0, fromCache: 0, queries: 0, mfrCandidates: 0, buyCandidates: 0 };
  const results = [];

  for (const file of walkDataFiles(dataDir)) {
    let parsed;
    try {
      parsed = JSON.parse(fs.readFileSync(file, "utf8"));
    } catch (e) {
      continue;
    }
    const caps = Object.values(parsed.capabilities || {});
    if (!caps.length) continue;
    const { manufacturer, model } = caps[0];
    if (!manufacturer || !model || norm(manufacturer) === "unknown") continue;
    stats.devices++;
    const refs = parsed.references || {};
    const relFile = path.relative(process.cwd(), file).split(path.sep).join("/");

    // A human-supplied retail identity (`references.product`, e.g. from a
    // submitter's note: "sold as Gosund NiteBird EP2-Z") beats Z2M's,
    // which for white-label Tuya devices is often just "Tuya TS011F".
    const z2m = await z2mIdentity(zhcPath, manufacturer, model);
    const product = refs.product && refs.product.brand ? refs.product : null;
    const identity = product
      ? {
          ...(z2m || {}),
          brand: product.brand,
          brandIsGeneric: norm(product.brand) === "tuya",
          retailModel: product.model || (z2m && z2m.retailModel) || null,
          description: product.name || (z2m && z2m.description) || null,
          z2mModel: z2m ? z2m.z2mModel : null,
          z2mVendor: z2m ? z2m.z2mVendor : null,
          z2mSupported: !!z2m,
          source: product.source || "references.product",
        }
      : z2m && { ...z2m, z2mSupported: true };
    const isTuya = looksLikeTuyaManufacturerString(manufacturer);
    // Most specific brand we can name. Our own manufacturer string is used
    // when Z2M has nothing, unless it's a Tuya code (meaningless as a brand).
    const brand = identity && !identity.brandIsGeneric ? identity.brand : !isTuya ? manufacturer : identity ? identity.brand : null;
    const brandIsGeneric = !brand || norm(brand) === "tuya";
    const deviceTypes = (parsed.observations || []).flatMap((o) => (o.endpoints || []).map((e) => e.endpoint && e.endpoint.device_type));
    const tokens = evidenceTokens(identity, model);

    const needsMfr = !(refs.manufacturer && refs.manufacturer.url) && refs.manufacturer_declined !== true;
    // Title + "is it a shop page" for an already-approved manufacturer
    // link (e.g. one added by hand) — fetched once per URL and cached.
    let approved = null;
    if (refs.manufacturer && refs.manufacturer.url) {
      const u = refs.manufacturer.url;
      cache.pages = cache.pages || {};
      if ((!(u in cache.pages) || (refresh && cache.pages[u] === null)) && allowNetwork) {
        const r = (await http.allowedByRobots(u)) ? await http.get(u) : null;
        cache.pages[u] = r && r.status < 400 && r.text ? { title: pageTitle(r.text, brand), shop: htmlLooksLikeShop(r.text) } : null;
        cacheChanged = true;
      }
      approved = cache.pages[u] ? { url: u, ...cache.pages[u] } : { url: u, title: null, shop: looksLikeShopPage(u) };
    }

    // A where-to-buy link only matters for a Blakadder submission draft,
    // i.e. a device that isn't (yet) known to be on Blakadder.
    const needsBuy = !(refs.blakadder && refs.blakadder.url) && !(approved && approved.shop);
    const key = `${manufacturer}|${model}`;
    let entry = cache.devices[key];
    // `partial`: the search API was skipped for this device last time
    // (quota/budget ran out, or the API was failing) — retry next run.
    const stale = !entry || refresh || entry.partial === true || daysSince(entry.searched_at, today) > CACHE_MAX_AGE_DAYS;

    if ((needsMfr || needsBuy) && stale && allowNetwork && tokens.length) {
      stats.searched++;
      const found = { manufacturer: null, buy: null };
      const domains = vendorDomainsFor([brand, identity && identity.brand, identity && identity.z2mVendor, manufacturer], curated, fromBlakadder);
      const searchTerms = [identity && identity.retailModel, model].filter((m, i, a) => m && norm(m).length >= 3 && a.findIndex((x) => norm(x) === norm(m)) === i);

      const tryManufacturer = async (url, method) => {
        if (found.manufacturer || !url || isRetailerUrl(url) || isIgnoredUrl(url) || isBareHomepage(url)) return;
        const onVendorSite = domains.some((d) => sameSite(url, d)) || (!brandIsGeneric && domainLooksLikeVendor(url, brand));
        if (!onVendorSite) return;
        const v = await verifyPage(http, url, tokens, brand);
        if (v) found.manufacturer = { ...v, method };
      };
      const tryBuy = async (url, method, searchTitle) => {
        if (found.buy || !url || isIgnoredUrl(url) || isBareHomepage(url) || !isRetailerUrl(url)) return;
        // Big retailers mostly block bots, so a retailer hit counts when
        // either its page or the search result's own title names the model.
        const titleHit = tokens.find((t) => norm(searchTitle).includes(t));
        if (titleHit) {
          found.buy = { url, title: searchTitle, evidence: `search result title mentions "${titleHit}"`, method };
          return;
        }
        const v = await verifyPage(http, url, tokens, brand);
        if (v) found.buy = { ...v, method };
      };

      // 1. Search API.
      let apiSkipped = !!searchKey && (queriesLeft <= 0 || searchApiFailures >= 3);
      if (queriesLeft > 0 && searchApiFailures < 3) {
        const queries = [];
        for (const t of searchTerms) queries.push(brandIsGeneric ? `${t} zigbee` : `${brand} ${t}`);
        if (isTuya) queries.push(`"${manufacturer}" ${model}`);
        for (const q of queries) {
          if (queriesLeft <= 0 || (found.manufacturer && found.buy)) break;
          queriesLeft--;
          stats.queries++;
          const r = await braveSearch(http, fetchImpl, searchKey, q);
          if (!r.ok) {
            searchApiFailures++;
            apiSkipped = true;
            continue;
          }
          for (const hit of r.results) {
            await tryManufacturer(hit.url, `search: ${q}`);
            await tryBuy(hit.url, `search: ${q}`, hit.title);
          }
        }
      }
      // 2. Vendor's own site, no key needed.
      for (const d of domains.slice(0, 3)) {
        if (found.manufacturer) break;
        for (const t of searchTerms) {
          for (const u of await shopSearch(http, d, t)) await tryManufacturer(u, `shop search on ${d}`);
          if (found.manufacturer) break;
        }
        if (!found.manufacturer) {
          for (const u of await sitemapSearch(http, d, tokens)) await tryManufacturer(u, `sitemap of ${d}`);
        }
      }
      entry = {
        searched_at: today,
        manufacturer_candidate: found.manufacturer,
        buy_candidate: found.buy,
      };
      if (apiSkipped && !(found.manufacturer && found.buy)) entry.partial = true;
      cache.devices[key] = entry;
      cacheChanged = true;
    } else if (entry) {
      stats.fromCache++;
    }

    const mfrCandidate = entry && entry.manufacturer_candidate;

    if (mfrCandidate && needsMfr) stats.mfrCandidates++;
    if (entry && entry.buy_candidate) stats.buyCandidates++;

    // --- Blakadder submission draft ---
    const mfrUrl = (refs.manufacturer && refs.manufacturer.url) || (mfrCandidate && mfrCandidate.url) || "";
    // Where to buy: the vendor's own page if it's a shop listing, else a
    // retailer listing found by search.
    const vendorShop = approved ? approved.shop : !!(mfrCandidate && (mfrCandidate.shop ?? looksLikeShopPage(mfrCandidate.url)));
    const vendorLink = (mfrUrl && vendorShop ? mfrUrl : "") || (entry && entry.buy_candidate && entry.buy_candidate.url) || "";
    // Blakadder's device titles don't repeat the brand ("Blue Series Smart
    // 2-1 Switch/Dimmer", vendor "Inovelli"), so drop a leading brand name.
    const stripBrand = (t) => {
      if (!t || !brand) return t || "";
      const re = new RegExp(`^${brand.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")}[\\s:|–-]+`, "i");
      const out = t.replace(re, "").trim();
      return out.length >= 3 ? out : t;
    };
    const deviceName = stripBrand((approved && approved.title) || (mfrCandidate && mfrCandidate.title) || (identity && identity.description) || "");
    const gateways = ["ZHA"];
    if (identity && identity.z2mSupported) gateways.push("Zigbee2MQTT");
    const fields = {
      manufacturer: brandIsGeneric ? (isTuya ? "Tuya" : "") : brand,
      deviceName,
      model: (identity && identity.retailModel) || model,
      zigbeeId: isTuya ? manufacturer : model,
      category: guessCategory([deviceName, identity && identity.description, model], deviceTypes) || "",
      vendorLink,
      manufacturerLink: mfrUrl,
      gateways,
      description: "",
      notes:
        `Zigbee signature from a ZHA scan: manufacturer "${manufacturer}", model "${model}".` +
        (product ? ` Retail identity (${product.brand}${product.model ? " " + product.model : ""}) from ${product.source || "the device's submitter"}.` : "") +
        ` Capability scan: https://hsolgaard.github.io/zigbee-capabilities/`,
    };
    const missing = [];
    if (!fields.manufacturer) missing.push("manufacturer / brand");
    if (!fields.deviceName) missing.push("device name");
    if (!fields.category) missing.push("category");
    if (!fields.vendorLink) missing.push("vendor (where to buy) link");
    results.push({
      file: relFile,
      manufacturer,
      model,
      identity,
      manufacturerCandidate: needsMfr ? mfrCandidate || null : null,
      buyCandidate: (entry && entry.buy_candidate) || null,
      draft: { fields, missing, prefillUrl: missing.length ? null : prefillUrl(fields) },
    });
  }

  if (cacheChanged) {
    cache.generated_at = new Date().toISOString();
    const sorted = Object.fromEntries(Object.entries(cache.devices).sort(([a], [b]) => a.localeCompare(b)));
    fs.writeFileSync(cachePath, JSON.stringify({ ...cache, devices: sorted }, null, 2) + "\n");
  }
  log(
    `Vendor discovery: ${stats.devices} device(s), ${stats.searched} searched (${stats.queries} search-API queries${searchKey ? "" : ", no BRAVE_SEARCH_API_KEY set — vendor-site search only"}), ` +
      `${stats.fromCache} from cache; ${stats.mfrCandidates} manufacturer-link candidate(s), ${stats.buyCandidates} where-to-buy link(s).`
  );
  return { results, stats, cacheChanged, searchApiFailures };
}

// CLI
if (import.meta.url === pathToFileURL(process.argv[1] || "").href) {
  const args = process.argv.slice(2);
  const arg = (name, def = null) => {
    const i = args.indexOf(`--${name}`);
    return i >= 0 && args[i + 1] && !args[i + 1].startsWith("--") ? args[i + 1] : def;
  };
  const out = arg("out", "/tmp/vendor-discovery.json");
  const r = await runDiscovery({
    dataDir: arg("data", "data"),
    blakadderDir: arg("blakadder"),
    zhcPath: arg("zhc"),
    cachePath: arg("cache", "external-references-cache.json"),
    refresh: args.includes("--refresh"),
    allowNetwork: !args.includes("--no-network"),
    queryBudget: Number(arg("budget", DEFAULT_QUERY_BUDGET)),
  });
  fs.writeFileSync(out, JSON.stringify(r, null, 2) + "\n");
  console.log(`Wrote ${out}`);
}
