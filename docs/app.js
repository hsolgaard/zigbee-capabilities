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
  confirmedCommands,
  notReportedCommands,
  confidenceLabel,
  groupCapabilitiesByOutcome,
  firmwareVersions,
  diffFirmware,
  interestingDiscoveries,
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

function confidenceClass(label) {
  return label.toLowerCase().replace(/[^a-z]+/g, "-").replace(/^-+|-+$/g, "");
}

let INDEX = [];
const search = { manufacturer: "", model: "", cluster: "", command: "", attribute: "", firmware: "" };
const expandedRows = new Set(); // keys are `${manufacturer}|${model}|${firmware}|${endpoint}`
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
  } endpoint/firmware record${INDEX.length === 1 ? "" : "s"} — built entirely from scans shared by the community.`;

  renderDiscoveries();
  buildSearch();
  buildCompare();
}

// ---- Interesting Discoveries ----
function renderDiscoveries() {
  const el = document.getElementById("discoveries");
  const discoveries = interestingDiscoveries(INDEX);
  el.innerHTML = discoveries.length
    ? `<div class="discoveries">
        <div class="discoveries-label">Interesting so far</div>
        <ul>${discoveries.map((d) => `<li>${escapeHtml(d.text)}</li>`).join("")}</ul>
      </div>`
    : "";
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

function searchExamples() {
  const resolve = (needle) => {
    const opts = facetValues("cluster");
    return opts.find((v) => v.toLowerCase().includes(needle)) || "";
  };
  return [
    { label: "Reports occupancy", field: "cluster", value: resolve("occupancy") },
    { label: "Reports illuminance", field: "cluster", value: resolve("illuminance") },
    { label: "Supports on/off control", field: "cluster", value: resolve("on/off") },
    { label: "Supports dimming", field: "cluster", value: resolve("level") },
    { label: "Supports color control", field: "cluster", value: resolve("color") },
  ].filter((ex) => ex.value);
}

function buildSearch() {
  const examplesEl = document.getElementById("search-examples");
  examplesEl.innerHTML = searchExamples()
    .map(
      (ex) =>
        `<button type="button" class="chip" data-field="${escapeHtml(ex.field)}" data-value="${escapeHtml(
          ex.value
        )}">${escapeHtml(ex.label)}</button>`
    )
    .join("");
  examplesEl.querySelectorAll(".chip").forEach((btn) => {
    btn.addEventListener("click", () => {
      SEARCH_FIELDS.forEach((f) => (search[f] = ""));
      search[btn.dataset.field] = btn.dataset.value;
      syncSearchSelects();
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
    const row = e.target.closest("tr.result-row");
    if (!row) return;
    const key = row.dataset.key;
    if (expandedRows.has(key)) expandedRows.delete(key);
    else expandedRows.add(key);
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

function entryKey(entry) {
  return `${entry.manufacturer}|${entry.model}|${entry.firmware}|${entry.endpoint}`;
}

function runSearch() {
  const tbody = document.getElementById("results-body");
  const countEl = document.getElementById("search-count");
  const all = searchIndex(INDEX, search);
  const results = all.slice(0, 200);

  countEl.textContent =
    all.length > 200
      ? `Showing first 200 of ${all.length} matching records — narrow your search to see more.`
      : `${all.length} matching record${all.length === 1 ? "" : "s"}`;

  if (!results.length) {
    tbody.innerHTML = `<tr><td colspan="9" class="muted">No matching records — that's likely a coverage gap, not proof this device can't do it. Nobody's scanned and shared it yet.</td></tr>`;
    return;
  }

  tbody.innerHTML = results
    .map((entry) => {
      const key = entryKey(entry);
      const cmds = confirmedCommands(entry).map((c) => c.name);
      const notReported = notReportedCommands(entry).map((c) => c.name);
      const confidence = confidenceLabel(entry);
      const expanded = expandedRows.has(key);
      const row = `<tr class="result-row" data-key="${escapeHtml(key)}">
        <td>${expanded ? "▾" : "▸"}</td>
        <td>${escapeHtml(entry.manufacturer || "—")}</td>
        <td>${escapeHtml(entry.model || "—")}</td>
        <td>${escapeHtml(entry.firmware || "unknown")}</td>
        <td>${entry.endpoint ?? "—"}</td>
        <td>${cmds.length ? escapeHtml(cmds.join(", ")) : `<span class="muted">none confirmed</span>`}</td>
        <td>${notReported.length ? escapeHtml(notReported.join(", ")) : `<span class="muted">—</span>`}</td>
        <td>${entry.scan_count || 0}</td>
        <td><span class="badge badge-${confidenceClass(confidence)}">${escapeHtml(confidence)}</span></td>
      </tr>`;
      const detail = expanded
        ? `<tr class="detail-row" data-key="${escapeHtml(key)}"><td colspan="9">${capabilityOutcomesHtml(
            entry
          )}</td></tr>`
        : "";
      return row + detail;
    })
    .join("");
}

function capabilityOutcomesHtml(entry) {
  const groups = groupCapabilitiesByOutcome([entry]);
  if (!groups.length) return `<p class="muted">No confirmed commands or reporting clusters recorded for this record.</p>`;
  return `<div class="cap-groups">${groups
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
            : ""
        }
      </div>`
    )
    .join("")}</div>`;
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
