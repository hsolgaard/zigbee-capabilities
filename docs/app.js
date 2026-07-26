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
  searchIndex,
  groupSearchResultsByDevice,
  groupCapabilitiesByOutcome,
  firmwareVersions,
  diffFirmware,
  interestingDiscoveries,
  confidenceStars,
} from "./capexplorer.js";

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

let INDEX = [];
const search = { manufacturer: "", model: "", cluster: "", command: "", attribute: "", firmware: "" };
const expandedDevices = new Set(); // keys are `${manufacturer_slug}|${model_slug}`
const compare = { manufacturer: "", model: "", firmwareA: "", firmwareB: "" };

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

  renderDiscoveries();
  buildSearch();
  buildCompare();
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
  if (field === "manufacturer") INDEX.forEach((e) => e.manufacturer && set.add(e.manufacturer));
  else if (field === "model") INDEX.forEach((e) => e.model && set.add(e.model));
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
  const matched = searchIndex(INDEX, search);
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
          <div class="device-card-header">${escapeHtml(r.manufacturer || "—")} ${escapeHtml(r.model || "—")}</div>
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
          ${goodForHtml(r.goodFor)}
          <div class="techtoggle" data-key="${escapeHtml(key)}">
            ${expanded ? "Hide capabilities ▾" : "View capabilities →"}
          </div>
          ${expanded ? `<div class="tech-panel">${capabilitiesGroupsHtml(r.entries)}</div>` : ""}
        </div>`;
    })
    .join("");
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

function capabilitiesGroupsHtml(entries) {
  const groups = groupCapabilitiesByOutcome(entries);
  if (!groups.length) return `<p class="muted">No confirmed commands or reporting clusters recorded yet.</p>`;
  // Same split as the card: a reports-only cluster this card/site can't
  // put a real name to (raw "Cluster 0xNNNN" fallback) gets combined into
  // one summary line instead of its own bold heading with nothing under
  // it, which reads as broken rather than as "reports data."
  const shown = groups.filter((g) => g.identified || !g.reportsOnly);
  const unidentifiedEmpty = groups.filter((g) => !g.identified && g.reportsOnly);
  const groupsHtml = shown
    .map(
      (g) => `
      <div class="cap-group">
        <span class="cap-group-label">${escapeHtml(g.label)}</span>
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
  return `<div class="cap-groups">${groupsHtml}${unidentifiedHtml}</div>`;
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
