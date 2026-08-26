// -----------------------------------------------------------------------
// Cluster Glossary page (docs/clusters.html)
// -----------------------------------------------------------------------
// Plain-DOM rendering, no framework — same pattern as app.js/review.js.
// Pulls the live community index so the glossary only ever lists clusters
// this database has actually seen (never a guess at what might exist),
// and prefers whatever resolved name the community data itself carries
// over the curated fallback name — same "real evidence wins" rule as the
// rest of the site.
import { fetchCapabilityIndex } from "./capexplorer.js";
import { capabilityOutcomePhrase } from "./capexplorer-constants.js";
import { CLUSTER_GLOSSARY, UNCURATED_CLUSTER_NOTE } from "./cluster-glossary-data.js";

function escapeHtml(s) {
  return String(s == null ? "" : s).replace(/[&<>"']/g, (c) => ({
    "&": "&amp;",
    "<": "&lt;",
    ">": "&gt;",
    '"': "&quot;",
    "'": "&#39;",
  }[c]));
}

function hex4(id) {
  return `0x${Number(id).toString(16).padStart(4, "0")}`;
}

// Walks the whole live index once, building clusterId -> { count, name,
// sawAsInput, sawAsOutput } — the same in_clusters/out_clusters/clusters
// fields every other data-layer function on this site reads (see
// groupCapabilitiesByOutcome in capexplorer.js), just aggregated across
// every device instead of one device's entries.
function collectClusterStats(index) {
  const stats = new Map();
  index.forEach((entry) => {
    const inSet = new Set(entry.in_clusters || []);
    const outSet = new Set(entry.out_clusters || []);
    const seen = new Set([...inSet, ...outSet, ...Object.keys(entry.clusters || {})]);
    seen.forEach((clusterId) => {
      if (!stats.has(clusterId)) stats.set(clusterId, { count: 0, name: null, sawAsInput: false, sawAsOutput: false });
      const s = stats.get(clusterId);
      s.count += 1;
      const cluster = (entry.clusters || {})[clusterId];
      const resolvedName = cluster && (cluster.resolved_name || cluster.name);
      if (resolvedName) s.name = capabilityOutcomePhrase(clusterId, resolvedName, entry.manufacturer);
      if (inSet.has(clusterId)) s.sawAsInput = true;
      if (outSet.has(clusterId)) s.sawAsOutput = true;
    });
  });
  return stats;
}

const CATEGORY_ORDER = ["Control", "Sensing", "Infrastructure", "Manufacturer-specific", "Not yet described"];

function buildEntries(stats) {
  const entries = [];
  stats.forEach((s, clusterId) => {
    const curated = CLUSTER_GLOSSARY[clusterId];
    const name = curated ? curated.name : s.name || capabilityOutcomePhrase(clusterId, null, null);
    entries.push({
      clusterId,
      name,
      count: s.count,
      sawAsInput: s.sawAsInput,
      sawAsOutput: s.sawAsOutput,
      category: curated ? curated.category : "Not yet described",
      whatItIs: curated ? curated.whatItIs : null,
      asInput: curated ? curated.asInput : null,
      asOutput: curated ? curated.asOutput : null,
    });
  });
  return entries.sort((a, b) => b.count - a.count || a.name.localeCompare(b.name));
}

function entryHtml(e) {
  const seenAs = [];
  if (e.sawAsInput) seenAs.push("Input");
  if (e.sawAsOutput) seenAs.push("Output");
  return `
    <div class="cluster-entry" id="cluster-${escapeHtml(e.clusterId)}">
      <div class="cluster-entry-header">
        <span class="cluster-entry-name">${escapeHtml(e.name)}</span>
        <span class="cluster-entry-id muted">${escapeHtml(e.clusterId)}</span>
        <span class="muted cluster-entry-count">seen on ${e.count} record${e.count === 1 ? "" : "s"}${
    seenAs.length ? ` — as ${seenAs.join(" and ")}` : ""
  }</span>
      </div>
      ${e.whatItIs ? `<p class="cluster-entry-what">${escapeHtml(e.whatItIs)}</p>` : ""}
      ${
        e.asInput
          ? `<p class="cluster-entry-role"><span class="badge badge-input">Input</span> ${escapeHtml(e.asInput)}</p>`
          : ""
      }
      ${
        e.asOutput
          ? `<p class="cluster-entry-role"><span class="badge badge-output">Output</span> ${escapeHtml(e.asOutput)}</p>`
          : ""
      }
      ${!e.whatItIs ? `<p class="cluster-entry-what muted">${escapeHtml(UNCURATED_CLUSTER_NOTE)}</p>` : ""}
    </div>`;
}

async function render() {
  const bodyEl = document.getElementById("clusters-body");
  const jumpEl = document.getElementById("clusters-jump");
  try {
    const index = await fetchCapabilityIndex();
    const stats = collectClusterStats(index);
    const entries = buildEntries(stats);
    const byCategory = new Map();
    entries.forEach((e) => {
      if (!byCategory.has(e.category)) byCategory.set(e.category, []);
      byCategory.get(e.category).push(e);
    });

    const orderedCategories = [
      ...CATEGORY_ORDER.filter((c) => byCategory.has(c)),
      ...[...byCategory.keys()].filter((c) => !CATEGORY_ORDER.includes(c)),
    ];

    jumpEl.innerHTML = orderedCategories
      .map((c) => `<a href="#cat-${escapeHtml(c.replace(/\s+/g, "-").toLowerCase())}">${escapeHtml(c)}</a>`)
      .join(" · ");

    bodyEl.innerHTML = orderedCategories
      .map(
        (c) => `
        <section id="cat-${escapeHtml(c.replace(/\s+/g, "-").toLowerCase())}">
          <h2>${escapeHtml(c)}</h2>
          ${byCategory.get(c).map(entryHtml).join("")}
        </section>`
      )
      .join("");
  } catch (err) {
    bodyEl.innerHTML = `<p class="muted">Couldn't load the community database right now (${escapeHtml(
      err && err.message ? err.message : String(err)
    )}). Try refreshing.</p>`;
  }
}

render();
