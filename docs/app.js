// -----------------------------------------------------------------------
// zigbee-capabilities standalone site — the browser-facing half.
// -----------------------------------------------------------------------
// Everything data-related here comes from capexplorer.js (copied verbatim
// from the ZHA Bindings Manager card's own src/ by build.js — see that
// repo for the source of truth). This file is the part that's genuinely
// new: plain-DOM rendering, since none of card.js's shadow-DOM/dialog
// machinery applies to a normal webpage. No "Explore my devices" mode
// here either — there's no Home Assistant instance to cross-reference
// against on a public site, so Search and Compare (plus the same
// Interesting Discoveries panel) are the whole product.
import {
  fetchCapabilityIndex,
  fetchUnknownCapabilities,
  searchIndex,
  groupSearchResultsByDevice,
  groupCapabilitiesByOutcome,
  firmwareVersions,
  diffFirmware,
  interestingDiscoveries,
  confidenceStars,
  deviceOverview,
  CAPABILITY_ROLE_LABEL,
  CAPABILITY_ROLE_EXPLANATION,
} from "./capexplorer.js";
import { deviceImageUrl } from "./capexplorer-constants.js";

function escapeHtml(s) {
  return String(s == null ? "" : s).replace(/[&<>"']/g, (c) => ({
    "&": "&amp;",
    "<": "&lt;",
    ">": "&gt;",
    '"': "&quot;",
    "'": "&#39;",
  }[c]));
}

function formatDate(iso) {
  const d = new Date(iso);
  if (isNaN(d.getTime())) return iso;
  return d.toLocaleDateString(undefined, { month: "short", year: "numeric" });
}

// ---- Generic Tuya grouping (website-only display/filter convenience) ----
// Tuya modules get reused verbatim across dozens of unrelated rebrands: the
// underscore-prefixed manufacturer string ZHA/Z2M actually see (e.g.
// "_TZ3000_46t1rvdu") is an internal Tuya production code, not a name
// anyone recognizes as their own device. This is display/filter-layer
// only — deliberately does NOT touch capexplorer.js (the card's own
// shared, copied-verbatim source of truth) or the underlying manufacturer
// data anywhere: matching, dedup, and submissions all still need the raw
// string exactly as scanned. See AMBIGUOUS_TUYA_MODELS in
// capexplorer-constants.js for the same "same numbers, different real
// products" problem already accepted for device photos.
const GENERIC_TUYA_LABEL = "Generic Tuya";
const TUYA_MANUFACTURER_PATTERN = /^_T[A-Z0-9]+_/i;
function isGenericTuyaManufacturer(m) {
  return TUYA_MANUFACTURER_PATTERN.test(String(m || ""));
}
// For headings/labels — keeps the raw code visible (still searchable,
// still unambiguous) while giving casual readers context.
function manufacturerDisplayLabel(m) {
  if (!m) return "—";
  return isGenericTuyaManufacturer(m) ? `${GENERIC_TUYA_LABEL} (${m})` : m;
}

let INDEX = [];
const search = { manufacturer: "", model: "", cluster: "", command: "", attribute: "", firmware: "" };
const expandedDevices = new Set(); // keys are `${manufacturer_slug}|${model_slug}`
const compare = { manufacturer: "", model: "", firmwareA: "", firmwareB: "" };

// ---- Device photos ----
// Persisted opt-out, matching the ZHA Bindings Manager card's own "Show
// device photo" toggle (same key naming convention as capexplorer.js's
// index cache) — the photos themselves come from zigbee2mqtt.io, so this
// is both a bandwidth and a privacy-posture choice, not just cosmetic.
const SHOW_PHOTOS_KEY = "zha-capability-explorer:show-photos";
function loadShowPhotos() {
  try {
    const raw = localStorage.getItem(SHOW_PHOTOS_KEY);
    return raw === null ? true : raw === "1";
  } catch (e) {
    return true;
  }
}
function saveShowPhotos(value) {
  try {
    localStorage.setItem(SHOW_PHOTOS_KEY, value ? "1" : "0");
  } catch (e) {
    /* ignore quota/availability errors — this is a nice-to-have, not required */
  }
}
let showPhotos = loadShowPhotos();

// Renders either the device's photo or a generic fallback shape — never a
// broken-image glyph. Failed loads are caught by a single delegated
// 'error' listener (see buildSearch) rather than an inline onerror
// attribute, so this stays plain string templating like the rest of the
// file.
function devicePhotoHtml(model) {
  if (!showPhotos) return "";
  const url = deviceImageUrl(model);
  if (!url) return `<div class="device-photo-fallback" aria-hidden="true"></div>`;
  return `<img class="device-photo" src="${escapeHtml(url)}" alt="" loading="lazy">`;
}

async function init() {
  const statsEl = document.getElementById("stats");
  try {
    INDEX = await fetchCapabilityIndex();
  } catch (err) {
    statsEl.textContent = `Couldn't load the community database: ${err.message || err}. Try reloading.`;
    return;
  }

  const uniqueDevices = new Set(INDEX.map((e) => `${e.manufacturer_slug}|${e.model_slug}`));
  statsEl.textContent = `${uniqueDevices.size} device${uniqueDevices.size === 1 ? "" : "s"} confirmed across ${
    INDEX.length
  } firmware observation${INDEX.length === 1 ? "" : "s"} — built entirely from scans shared by the community.`;

  const photoToggle = document.getElementById("show-photos-toggle");
  if (photoToggle) {
    photoToggle.checked = showPhotos;
    photoToggle.addEventListener("change", () => {
      showPhotos = photoToggle.checked;
      saveShowPhotos(showPhotos);
      runSearch();
    });
  }

  renderDiscoveries();
  const deepLinked = applyDeepLinkFromQueryString();
  buildSearch();
  if (deepLinked) {
    syncSearchSelects();
    const advanced = document.querySelector(".advanced-filters");
    if (advanced) advanced.open = true;
  }
  buildCompare();
  renderUnknowns(); // fire-and-forget — its own small section, shouldn't block the rest of the page
}

// Lets an external caller (currently: the ZHA Bindings Manager card's
// Capability Explorer tab — see zha-binding-map-card.js's
// _capExpWebsiteUrl()) deep-link straight to one device's search result
// instead of just the site root, via ?manufacturer=&model=. Sets the raw
// values into `search` before buildSearch()'s own runSearch() call picks
// them up, so the very first render already shows the right device — no
// exact-option match required, since searchIndex()'s manufacturer/model
// facets are substring matches, not select-option equality (this also
// means a raw Tuya manufacturer string like "_TZ3000_xxxx" still filters
// correctly even though the dropdown itself only ever offers "Generic
// Tuya" as an option for that family — see facetValues()/runSearch()).
function applyDeepLinkFromQueryString() {
  const params = new URLSearchParams(window.location.search);
  const manufacturer = params.get("manufacturer");
  const model = params.get("model");
  if (!manufacturer && !model) return false;
  if (manufacturer) search.manufacturer = manufacturer;
  if (model) search.model = model;
  return true;
}

// ---- Unidentified capabilities (the "known unknowns" tracker) ----
function totalSeen(row) {
  return (row.seen_on || []).reduce((sum, s) => sum + (s.count || 0), 0);
}

function unknownsTableHtml(rows, kind) {
  return `<div class="table-scroll"><table>
    <thead><tr><th>${kind === "cluster" ? "Cluster" : "Cluster / Attribute"}</th><th>Seen on</th><th>Times seen</th></tr></thead>
    <tbody>${rows
      .map((r) => {
        const idLabel =
          kind === "cluster" ? escapeHtml(r.id_hex) : `${escapeHtml(r.cluster_id_hex)} / ${escapeHtml(r.id_hex)}`;
        const seenOn = (r.seen_on || [])
          .map((s) => escapeHtml(`${s.manufacturer || "unknown"} ${s.model || "unknown"}`))
          .join(", ");
        return `<tr><td>${idLabel}</td><td>${seenOn}</td><td>${totalSeen(r)}</td></tr>`;
      })
      .join("")}</tbody>
  </table></div>`;
}

async function renderUnknowns() {
  const el = document.getElementById("unknowns-body");
  if (!el) return;
  let data;
  try {
    data = await fetchUnknownCapabilities();
  } catch (err) {
    el.innerHTML = `<p class="muted">Couldn't load this list right now (${escapeHtml(err.message || String(err))}).</p>`;
    return;
  }
  const clusters = data.unresolved_clusters || [];
  const attrs = data.unresolved_attributes || [];
  if (!clusters.length && !attrs.length) {
    el.innerHTML = `<p class="muted">Nothing unidentified right now — every manufacturer-specific cluster and attribute seen so far has a name.</p>`;
    return;
  }
  el.innerHTML = `
    ${clusters.length ? `<h3 class="unknowns-subhead">Clusters (${clusters.length})</h3>${unknownsTableHtml(clusters, "cluster")}` : ""}
    ${attrs.length ? `<h3 class="unknowns-subhead">Attributes (${attrs.length})</h3>${unknownsTableHtml(attrs, "attribute")}` : ""}
    ${data.generated_at ? `<p class="hint muted">Generated ${escapeHtml(formatDate(data.generated_at))} from the current database.</p>` : ""}
  `;
}

// ---- Community heartbeat (formerly "Interesting so far") ----
// Real feedback on the card's identical panel: leading with a fact like
// "newest contribution: X on firmware Y" doesn't read as interesting to
// someone researching a specific device — it's an artifact of how the
// highlight was computed, not a message aimed at the reader. The lead
// sentence always renders (frames this as a living, community-built
// resource); the conservatively-gated specific highlights (see
// interestingDiscoveries' own doc comment) still follow underneath when
// there are any worth showing.
function renderDiscoveries() {
  const el = document.getElementById("discoveries");
  const discoveries = interestingDiscoveries(INDEX);
  el.innerHTML = `<div class="discoveries">
      <div class="discoveries-label">Community heartbeat</div>
      <p class="discoveries-lead">This dataset is entirely community-built. Every scan shared by the community
        adds real evidence for others deciding whether to buy or configure a device.</p>
      ${discoveries.length ? `<ul>${discoveries.map((d) => `<li>${escapeHtml(d.text)}</li>`).join("")}</ul>` : ""}
    </div>`;
}

// ---- Search ----
const SEARCH_FIELDS = ["manufacturer", "model", "cluster", "command", "attribute", "firmware"];

function facetValues(field) {
  const set = new Set();
  if (field === "manufacturer") {
    let hasGenericTuya = false;
    INDEX.forEach((e) => {
      if (!e.manufacturer) return;
      if (isGenericTuyaManufacturer(e.manufacturer)) hasGenericTuya = true;
      else set.add(e.manufacturer);
    });
    // One "Generic Tuya" entry stands in for every _TZ.../_TY... code so
    // the dropdown isn't dominated by strings nobody recognizes — see
    // runSearch() for how selecting it expands back to all of them.
    if (hasGenericTuya) set.add(GENERIC_TUYA_LABEL);
  } else if (field === "model") INDEX.forEach((e) => e.model && set.add(e.model));
  else if (field === "firmware") INDEX.forEach((e) => set.add(e.firmware || "unknown"));
  else if (field === "cluster") {
    INDEX.forEach((e) => Object.values(e.clusters || {}).forEach((c) => c.name && set.add(c.name)));
  } else if (field === "command") {
    INDEX.forEach((e) =>
      Object.values(e.clusters || {}).forEach((c) =>
        (c.commands_received || []).forEach((row) => {
          if (row.present === true && row.name) set.add(row.name);
        })
      )
    );
  } else if (field === "attribute") {
    INDEX.forEach((e) =>
      Object.values(e.clusters || {}).forEach((c) =>
        (c.attributes_confirmed || []).forEach((a) => {
          if (a.name) set.add(a.name);
        })
      )
    );
  }
  return [...set].sort((a, b) => a.localeCompare(b));
}

// Grouped Quick Search chips (Lighting / Sensors / Networking) — mirrors
// the card's own _capExpSearchExampleGroups(), including its two
// deliberate deviations from a literally-requested example list: "Motion
// detection" and "Occupancy sensing" are combined into one chip (both
// would otherwise resolve to the identical Occupancy Sensing cluster
// filter, which would read as broken, not helpful), and "Attribute
// reporting" isn't included (no single facet value means "reports
// something" in general — every reporting cluster reports its own
// specific attribute — so a chip for it would need a new kind of search
// facet, out of scope for a wording/UX pass).
function searchExampleGroups() {
  const resolve = (needle) => {
    const opts = facetValues("cluster");
    return opts.find((v) => v.toLowerCase().includes(needle)) || "";
  };
  const groups = [
    {
      category: "Lighting",
      examples: [
        { label: "Switch things on/off", field: "cluster", value: resolve("on/off") },
        { label: "Direct dimming", field: "cluster", value: resolve("level") },
        { label: "Scene control", field: "cluster", value: resolve("scene") },
        { label: "Color control", field: "cluster", value: resolve("color") },
      ],
    },
    {
      category: "Sensors",
      examples: [
        { label: "Motion / occupancy sensing", field: "cluster", value: resolve("occupancy") },
        { label: "Reports illuminance", field: "cluster", value: resolve("illuminance") },
        { label: "Security / contact sensing (IAS Zone)", field: "cluster", value: resolve("ias zone") },
        { label: "Temperature monitoring", field: "cluster", value: resolve("temperature") },
        { label: "Humidity monitoring", field: "cluster", value: resolve("humidity") },
        { label: "Energy monitoring", field: "cluster", value: resolve("metering") },
      ],
    },
    {
      category: "Networking",
      examples: [
        { label: "Group control", field: "cluster", value: resolve("groups") },
        { label: "OTA support", field: "cluster", value: resolve("ota") },
      ],
    },
  ];
  return groups.map((g) => ({ ...g, examples: g.examples.filter((ex) => ex.value) })).filter((g) => g.examples.length);
}

function buildSearch() {
  const examplesEl = document.getElementById("search-examples");
  examplesEl.innerHTML = searchExampleGroups()
    .map(
      (g) => `
      <div class="search-example-group">
        <div class="search-example-category">${escapeHtml(g.category)}</div>
        <div class="chip-row">
          ${g.examples
            .map(
              (ex) =>
                `<button type="button" class="chip" data-field="${escapeHtml(ex.field)}" data-value="${escapeHtml(
                  ex.value
                )}">${escapeHtml(ex.label)}</button>`
            )
            .join("")}
        </div>
      </div>`
    )
    .join("");
  examplesEl.querySelectorAll(".chip").forEach((btn) => {
    btn.addEventListener("click", () => {
      SEARCH_FIELDS.forEach((f) => (search[f] = ""));
      search[btn.dataset.field] = btn.dataset.value;
      syncSearchSelects();
      document.querySelector(".advanced-filters").open = true;
      runSearch();
    });
  });

  SEARCH_FIELDS.forEach((field) => {
    const select = document.getElementById(`f-${field}`);
    const opts = facetValues(field);
    const placeholder = { manufacturer: "All manufacturers", model: "All models", cluster: "All clusters",
      command: "All commands", attribute: "All attributes", firmware: "All firmware" }[field];
    select.innerHTML =
      `<option value="">${escapeHtml(placeholder)}</option>` +
      opts.map((v) => `<option value="${escapeHtml(v)}">${escapeHtml(v)}</option>`).join("");
    select.addEventListener("change", (e) => {
      search[field] = e.target.value;
      runSearch();
    });
  });

  document.getElementById("results-body").addEventListener("click", (e) => {
    const toggle = e.target.closest(".techtoggle");
    if (!toggle) return;
    const key = toggle.dataset.key;
    if (expandedDevices.has(key)) expandedDevices.delete(key);
    else expandedDevices.add(key);
    runSearch();
  });

  // A failed device photo (zigbee2mqtt.io doesn't have an image for this
  // exact model, network hiccup, etc.) swaps in the same generic fallback
  // shape used when no photo was attempted at all — never a broken-image
  // glyph. 'error' doesn't bubble, so this listens in the capture phase
  // instead of delegating normally.
  document.getElementById("results-body").addEventListener(
    "error",
    (e) => {
      const img = e.target.closest("img.device-photo");
      if (!img) return;
      const fallback = document.createElement("div");
      fallback.className = "device-photo-fallback";
      fallback.setAttribute("aria-hidden", "true");
      img.replaceWith(fallback);
    },
    true
  );

  runSearch();
}

function syncSearchSelects() {
  SEARCH_FIELDS.forEach((f) => {
    const select = document.getElementById(`f-${f}`);
    if (select) select.value = search[f];
  });
}

// Renders confidenceStars()' rating as a filled/empty star string, or a
// distinct "Conflicting" callout when the community's own scans disagree
// with each other — see confidenceStars' own doc comment (mirrors the
// card's _capExpStarsHtml).
function starsHtml(rating) {
  if (rating.conflicting) {
    return `<span class="trust-stars trust-conflict" title="Community confidence: the community's own scans disagree with each other for this device — see the technical detail below">⚠ Conflicting</span>`;
  }
  const filled = "★".repeat(rating.stars);
  const empty = "☆".repeat(5 - rating.stars);
  return `<span class="trust-stars" title="Community confidence: ${rating.stars}/5, based on ${rating.totalScans} scan${
    rating.totalScans === 1 ? "" : "s"
  }">${filled}${empty}</span>`;
}

// Find a Device — one result card per matched manufacturer+model instead
// of one row per firmware entry (see groupSearchResultsByDevice's own doc
// comment for why Community confidence/Good for reflect the whole device,
// not just the entries that happened to match this particular search).
function runSearch() {
  const resultsEl = document.getElementById("results-body");
  const countEl = document.getElementById("search-count");
  // "Generic Tuya" isn't a real manufacturer string any entry actually
  // has, so it can't go through capexplorer.js's own (shared, untouched)
  // substring match — ask it for everything else, then expand the
  // sentinel back out to every _TZ/_TY entry here instead.
  const isGenericTuyaFilter = search.manufacturer === GENERIC_TUYA_LABEL;
  const matched = searchIndex(INDEX, isGenericTuyaFilter ? { ...search, manufacturer: "" } : search).filter(
    (e) => !isGenericTuyaFilter || isGenericTuyaManufacturer(e.manufacturer)
  );
  const devices = groupSearchResultsByDevice(matched, INDEX);
  const shown = devices.slice(0, 100);

  if (!devices.length) {
    countEl.textContent = "";
    resultsEl.innerHTML = `<div class="empty-search">
      <p>No community observations currently match this search.</p>
      <p class="muted">This does not necessarily mean the capability is unsupported — it simply means nobody
        has submitted evidence for it yet.</p>
      <a class="btn" href="#contribute">Contribute a scan</a>
    </div>`;
    return;
  }

  countEl.textContent =
    devices.length > 100
      ? `Showing the top 100 of ${devices.length} matching devices, ranked by community confidence — narrow your search to see more.`
      : `${devices.length} matching device${devices.length === 1 ? "" : "s"}, ranked by community confidence`;

  resultsEl.innerHTML = shown
    .map((r) => {
      const key = `${r.manufacturerSlug}|${r.modelSlug}`;
      const expanded = expandedDevices.has(key);
      return `
        <div class="device-card">
          <div class="device-card-top">
            ${devicePhotoHtml(r.model)}
            <div class="device-card-main">
              <div class="device-card-header">${escapeHtml(manufacturerDisplayLabel(r.manufacturer))} ${escapeHtml(r.model || "—")}</div>
              <div class="trust-panel">
                ${starsHtml(r.rating)}
                <div class="trust-text">
                  <span class="trust-label">Community confidence</span>
                  <div class="trust-detail muted">
                    ${r.firmwareCount} firmware version${r.firmwareCount === 1 ? "" : "s"} ·
                    ${r.totalScans} observation${r.totalScans === 1 ? "" : "s"}${
        r.lastSeen ? ` · last confirmed ${escapeHtml(formatDate(r.lastSeen))}` : ""
      }
                  </div>
                </div>
              </div>
            </div>
          </div>
          ${deviceOverviewHtml(r.entries)}
          ${externalReferencesHtml(r.references, r.manufacturer)}
          ${goodForHtml(r.goodFor)}
          <div class="techtoggle" data-key="${escapeHtml(key)}">
            ${expanded ? "Hide capabilities ▾" : "View capabilities →"}
          </div>
          ${expanded ? `<div class="tech-panel">${capabilitiesGroupsHtml(r.entries)}</div>` : ""}
        </div>`;
    })
    .join("");
}

// "External references" line (PRD: "External Device References") — a
// Blakadder page and/or an official manufacturer/product page for this
// device, shown as supplementary context only. Deliberately reads nothing
// but `references.blakadder.url`/`references.manufacturer.url`: this
// function has no access to, and must never gain access to, capability or
// confidence data, since external references are never allowed to
// contribute to either (see the PRD's data-boundary rule). Renders nothing
// at all when neither link is present, and only ever the links that
// actually exist — never a placeholder for a missing one.
function externalReferencesHtml(references, manufacturer) {
  if (!references) return "";
  const links = [];
  // confidence === "high" is a deliberate belt-and-suspenders check: the
  // enrichment workflow only ever writes "high" into a device's committed
  // `references` block in the first place (anything less certain goes to
  // references-review.json for a human instead — see that workflow's
  // header comment), so this should never actually filter anything out in
  // practice. It's here anyway as the last line of defense against a
  // future manual edit accidentally publishing an unreviewed suggestion.
  if (references.blakadder && references.blakadder.url && references.blakadder.confidence === "high") {
    links.push({ label: "Blakadder", url: references.blakadder.url });
  }
  if (references.manufacturer && references.manufacturer.url && references.manufacturer.confidence === "high") {
    // Prefer the device's own recognizable manufacturer name (e.g.
    // "SONOFF") over the generic word "Manufacturer" per the PRD's UX spec
    // — "Generic Tuya" counts as recognizable here, an internal Tuya
    // production code does not.
    const mfrLabel = manufacturer
      ? (isGenericTuyaManufacturer(manufacturer) ? GENERIC_TUYA_LABEL : manufacturer)
      : "Manufacturer";
    links.push({ label: mfrLabel, url: references.manufacturer.url });
  }
  if (!links.length) return "";
  const linksHtml = links
    .map(
      (l) =>
        `<a href="${escapeHtml(l.url)}" target="_blank" rel="noopener noreferrer">${escapeHtml(l.label)} ↗</a>`
    )
    .join(" · ");
  return `<div class="device-external-refs muted">External references: ${linksHtml}</div>`;
}

// Plain-language pill for the overview paragraph specifically — same
// green/gray colors as the capability panel's Output/Input badges
// (reuses badge-output/badge-input for that). Leads with everyday wording
// rather than assuming a reader already knows the ZCL terms "Input"/
// "Output" — but doesn't hide those terms either, since the goal is to
// explain the concept, not avoid naming it: each pill's plain phrase is
// paired with the matching term in parentheses (and the hover tooltip
// spells out what that term actually means), so a reader picks up the
// vocabulary through repetition across the site rather than needing it
// front-loaded before they've seen what it describes. Same underlying
// fact either way (declared capable of sending a command directly to
// another device, vs. only ever receiving one).
function overviewControlBadgeHtml(canControl) {
  return canControl
    ? `<span class="badge badge-output" title="This site calls this an Output capability: the device's own Zigbee signature declares that it can send this command directly to another device. That's a declaration, not an independently tested behavior — accurate for the large majority of devices, but occasionally a device declares more than its hardware actually uses.">Can control other devices (Output)</span>`
    : `<span class="badge badge-input" title="This site calls this Input only: this device can only receive this command — it has no declared way to send it to another device.">Can't control other devices (Input only)</span>`;
}

// The "quick overview" a reader wants at a glance — 2-3 plain sentences
// covering what the device can be commanded to do, what it senses/reports,
// and (the newest, most decision-relevant fact) whether it can directly
// control another device over a bind. See deviceOverview's doc comment in
// capexplorer.js for why this is template-composed from confirmed evidence
// rather than generated by an LLM. Shown above the fold, right under the
// trust panel, so this reads before anything else on the card.
//
// The "control" sentence (device CAN control another device directly) and
// the "not-control" sentence (commandable on a switch/dimmer/etc.-type
// cluster but with no declared way to control one) each get a plain-
// language pill via overviewControlBadgeHtml — answering, explicitly, the
// exact buyer question this feature was built for ("before I buy this,
// can it directly control a separate relay?"). Silence was the original
// design here; an explicit "no" replaced it once it became clear that
// omission reads as "unknown," not "confirmed no." Renders nothing at all
// for a device with no evidence in any of these categories yet (shouldn't
// happen in practice — groupSearchResultsByDevice only builds cards for
// devices with at least one community entry — but keeps this safe if that
// ever changes).
// A hover tooltip alone isn't a real explanation — it's invisible until
// you happen to hover (and doesn't exist at all on a touchscreen), so
// anyone who doesn't already know what "Output"/"Input only" mean would
// see the pill's term and nothing backing it up. This puts the actual
// definition in view, in plain text, right where the term appears — the
// exact moment a reader is deciding whether a device is right for a
// specific job (see overviewControlBadgeHtml's doc comment for why the
// pill itself leads with plain language rather than assuming the term is
// already known). Only rendered when the overview actually used one of
// these terms; a card with no control/not-control sentence has nothing
// for this to define. Reuses .hint, the same small-print style as
// CAPABILITY_ROLE_LEGEND further down the card (in capabilitiesGroupsHtml)
// — deliberately worded a little differently there vs. here: the panel's
// version explains the *cluster-level* Input/Output badges shown per
// capability; this one explains the *device-level* pill just used above,
// so a reader who never expands "View capabilities" still gets the
// definition without needing to hunt for it.
function overviewRoleHintHtml(sentences) {
  if (!sentences.some((s) => s.kind === "control" || s.kind === "not-control")) return "";
  return `<div class="hint">
    <strong>Output</strong> means this device declares, in its own Zigbee signature, that it can send that command
    directly to another device over a Zigbee bind — without Home Assistant involved. That's the device's own
    declaration rather than an independently tested behavior: accurate for the large majority of devices, but
    occasionally a device declares a capability its hardware doesn't actually use. <strong>Input only</strong> means
    this device can only receive the command itself; it has no declared way to send it onward to control something
    else.
    <a href="clusters.html">What does this mean for each specific cluster? &rarr;</a>
  </div>`;
}

function deviceOverviewHtml(entries) {
  const sentences = deviceOverview(entries);
  if (!sentences.length) return "";
  const text = sentences
    .map((s) => {
      if (s.kind === "control") return `${overviewControlBadgeHtml(true)} ${escapeHtml(s.text)}`;
      if (s.kind === "not-control") return `${overviewControlBadgeHtml(false)} ${escapeHtml(s.text)}`;
      return escapeHtml(s.text);
    })
    .join(" ");
  return `<div class="device-overview">${text}</div>${overviewRoleHintHtml(sentences)}`;
}

function goodForHtml(goodFor) {
  if (!goodFor.length) return "";
  return `<div class="cap-goodfor">
       <span class="cap-group-label">Good for</span>
       <div class="cap-tags">${goodFor
         .map(
           (t) =>
             `<span class="tag"${
               t.exactFirmware ? "" : ` title="Confirmed on a different firmware than this device's most recent record — likely still applies, but not verified on that exact version."`
             }>${escapeHtml(t.label)}${t.exactFirmware ? "" : " *"}</span>`
         )
         .join("")}</div>
     </div>`;
}

function roleBadgeHtml(role) {
  const label = CAPABILITY_ROLE_LABEL[role] || CAPABILITY_ROLE_LABEL.unknown;
  const explanation = CAPABILITY_ROLE_EXPLANATION[role] || CAPABILITY_ROLE_EXPLANATION.unknown;
  // Reuses the site's existing .badge idiom (see the badge-strong-evidence/
  // badge-well-confirmed/etc. rules in style.css) rather than a one-off
  // style — same pill shape and sizing, just a role-specific color class.
  return `<span class="badge badge-${escapeHtml(role)}" title="${escapeHtml(explanation)}">${escapeHtml(
    label
  )}</span>`;
}

// Shown once above the first capability group, not repeated per group —
// the badges themselves are self-explanatory once you know the rule once.
// This is the exact distinction a real support case spent over an hour
// chasing before landing here: a device having existing bindings that use
// a cluster does NOT mean it can control another device with that cluster
// — an Input-only device can be commanded and can report its own state
// over a binding, but has no way to issue that cluster's commands outward.
// Reuses .hint, the site's existing small-print explanatory-text style
// (see the search page's own hints), rather than introducing a new class.
const CAPABILITY_ROLE_LEGEND = `
  <div class="hint">
    <strong>Input</strong> = this device can be commanded with that cluster (by Home Assistant, or by another
    device bound to it). <strong>Output</strong> = this device declares, in its own Zigbee signature, that it can
    itself control another device using that cluster, via a direct Zigbee bind. That declaration isn't
    independently tested — it holds for the large majority of devices, but occasionally a device declares a
    capability its hardware doesn't actually use. Most switches and dimmers — even ones with a physical button —
    are Input only: the button operates the device's own load, it doesn't send Zigbee commands to anything else.
  </div>`;

function capabilitiesGroupsHtml(entries) {
  const groups = groupCapabilitiesByOutcome(entries);
  if (!groups.length) return `<p class="muted">No confirmed commands or reporting clusters recorded yet.</p>`;
  // Same split as the card: a reports-only cluster this card/site can't
  // put a real name to (raw "Cluster 0xNNNN" fallback) gets combined into
  // one summary line instead of its own bold heading with nothing under
  // it, which reads as broken rather than as "reports data." An unscanned
  // output-only cluster is exempt from that merge even when unidentified —
  // "this device might control something over an undocumented cluster" is
  // worth its own line, not folded into a "reports on N clusters" summary
  // that would be describing the wrong thing entirely.
  const shown = groups.filter((g) => g.identified || !g.reportsOnly || g.unscanned);
  const unidentifiedEmpty = groups.filter((g) => !g.identified && g.reportsOnly && !g.unscanned);
  const groupsHtml = shown
    .map(
      (g) => `
      <div class="cap-group">
        <span class="cap-group-label">${escapeHtml(g.label)}</span>
        ${roleBadgeHtml(g.role)}
        ${
          g.items.length
            ? `<div class="cap-tags">${g.items
                .map(
                  (i) =>
                    `<span class="tag${i.firmwareDependent ? " tag-fwdep" : ""}">${escapeHtml(i.name)}${
                      i.firmwareDependent ? " · firmware-dependent" : ""
                    }</span>`
                )
                .join("")}</div>`
            : g.unscanned
            ? `<div class="cap-reportsonly muted">Declared as an output cluster — this device can potentially control another device with it, but this project's scans don't discover specific output-side commands.</div>`
            : `<div class="cap-reportsonly muted">Reports data on this cluster — no commands to send.</div>`
        }
      </div>`
    )
    .join("");
  const unidentifiedHtml = unidentifiedEmpty.length
    ? `<div class="cap-group cap-group-unidentified">
         <span class="cap-group-label">Other reported clusters</span>
         <div class="cap-reportsonly muted">Also reports on ${unidentifiedEmpty.length} manufacturer-specific
           cluster${unidentifiedEmpty.length === 1 ? "" : "s"} this site can't yet put a name to (${unidentifiedEmpty
        .map((g) => escapeHtml(g.clusterId))
        .join(", ")}) — no commands confirmed on any of them.</div>
       </div>`
    : "";
  return `<div class="cap-groups">${CAPABILITY_ROLE_LEGEND}${groupsHtml}${unidentifiedHtml}</div>`;
}

// ---- Compare firmware ----
function buildCompare() {
  const manufacturers = [...new Set(INDEX.map((e) => e.manufacturer).filter(Boolean))].sort();
  const mSelect = document.getElementById("c-manufacturer");
  mSelect.innerHTML = `<option value="">Select…</option>` + manufacturers.map((m) => `<option value="${escapeHtml(m)}">${escapeHtml(m)}</option>`).join("");

  mSelect.addEventListener("change", (e) => {
    compare.manufacturer = e.target.value;
    compare.model = "";
    compare.firmwareA = "";
    compare.firmwareB = "";
    renderCompareModelOptions();
    renderCompareFirmwareOptions();
    renderCompareResult();
  });
  document.getElementById("c-model").addEventListener("change", (e) => {
    compare.model = e.target.value;
    compare.firmwareA = "";
    compare.firmwareB = "";
    renderCompareFirmwareOptions();
    renderCompareResult();
  });
  document.getElementById("c-fwa").addEventListener("change", (e) => {
    compare.firmwareA = e.target.value;
    renderCompareResult();
  });
  document.getElementById("c-fwb").addEventListener("change", (e) => {
    compare.firmwareB = e.target.value;
    renderCompareResult();
  });

  renderCompareModelOptions();
  renderCompareFirmwareOptions();
  renderCompareResult();
}

function renderCompareModelOptions() {
  const models = compare.manufacturer
    ? [...new Set(INDEX.filter((e) => e.manufacturer === compare.manufacturer).map((e) => e.model).filter(Boolean))].sort()
    : [];
  const select = document.getElementById("c-model");
  select.innerHTML = `<option value="">Select…</option>` + models.map((m) => `<option value="${escapeHtml(m)}">${escapeHtml(m)}</option>`).join("");
  select.value = compare.model;
  select.disabled = !compare.manufacturer;
}

function entriesForCompareModel() {
  return compare.manufacturer && compare.model
    ? INDEX.filter((e) => e.manufacturer === compare.manufacturer && e.model === compare.model)
    : [];
}

function renderCompareFirmwareOptions() {
  const entries = entriesForCompareModel();
  const fwOptions = firmwareVersions(entries).map((f) => (f === null ? "unknown" : f));
  ["c-fwa", "c-fwb"].forEach((id) => {
    const select = document.getElementById(id);
    select.innerHTML = `<option value="">Select…</option>` + fwOptions.map((f) => `<option value="${escapeHtml(f)}">${escapeHtml(f)}</option>`).join("");
    select.value = id === "c-fwa" ? compare.firmwareA : compare.firmwareB;
    select.disabled = !entries.length;
  });
}

function pickEntry(entries, fw) {
  return entries
    .filter((e) => (e.firmware || "unknown") === fw)
    .sort((a, b) => Object.keys(b.clusters || {}).length - Object.keys(a.clusters || {}).length)[0];
}

function renderCompareResult() {
  const el = document.getElementById("compare-result");
  const entries = entriesForCompareModel();
  const entryA = compare.firmwareA ? pickEntry(entries, compare.firmwareA) : null;
  const entryB = compare.firmwareB ? pickEntry(entries, compare.firmwareB) : null;

  if (!entryA || !entryB) {
    el.innerHTML = `<p class="muted">Pick a manufacturer, model, and two firmware versions to compare.</p>`;
    return;
  }
  if (compare.firmwareA === compare.firmwareB) {
    el.innerHTML = `<p class="muted">Pick two different firmware versions to compare.</p>`;
    return;
  }

  const diff = diffFirmware(entryA, entryB);
  if (!diff.length) {
    el.innerHTML = `<p class="muted">No confirmed differences between these two firmware versions.</p>`;
    return;
  }

  el.innerHTML = diff
    .map((row) => {
      if (row.onlyIn) {
        return `<div class="diff-row">${escapeHtml(row.name)}: only confirmed on firmware ${escapeHtml(
          row.onlyIn === "A" ? compare.firmwareA : compare.firmwareB
        )}.</div>`;
      }
      const parts = [];
      if (row.addedCommands.length)
        parts.push(`<span class="diff-added">+ ${escapeHtml(row.addedCommands.join(", "))}</span>`);
      if (row.removedCommands.length)
        parts.push(`<span class="diff-removed">− ${escapeHtml(row.removedCommands.join(", "))}</span>`);
      row.attributeChanges.forEach((a) => {
        parts.push(
          `<span class="${a.change === "added" ? "diff-added" : "diff-removed"}">${
            a.change === "added" ? "+" : "−"
          } ${escapeHtml(a.name)} (attribute)</span>`
        );
      });
      return `<div class="diff-row"><strong>${escapeHtml(row.name)}</strong><br>${parts.join(" &nbsp; ")}</div>`;
    })
    .join("");
}

// Exported (not just called) so a test harness can `await` startup
// completing before asserting on rendered DOM — harmless in the browser,
// where nothing imports this module's exports.
export const ready = init();
