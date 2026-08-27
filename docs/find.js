// -----------------------------------------------------------------------
// Find the Right Device (docs/find.html)
// -----------------------------------------------------------------------
// Plain-DOM rendering, no framework — same pattern as app.js/review.js/
// clusters.js. Both "Ask in plain English" and "Build your search" funnel
// into the exact same structured requirements object and the exact same
// matchGuidedSearch() call from capexplorer.js — per the PRD's core
// principle ("AI interprets the question. Community scan evidence answers
// it."), and per this Phase 1/2 build, there is no AI here at all yet:
// the NL box runs parseNaturalLanguageQuery()'s deterministic rules only.
// A future Phase 3 (Cloudflare Workers AI fallback for what those rules
// can't confidently resolve) would replace parseNaturalLanguageQuery()'s
// role here, not matchGuidedSearch()'s — see the Rollout Plan project doc.
import {
  fetchCapabilityIndex,
  matchGuidedSearch,
  parseNaturalLanguageQuery,
  FIND_GOAL_OPTIONS,
  FIND_GOAL_REDIRECTS,
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

// Plain-English names for the only three clusters either the guided wizard
// or parseNaturalLanguageQuery's rules ever ask about (see NL_RULES and
// FIND_GOAL_OPTIONS in capexplorer.js) — kept here, not derived from the
// community data, since a requirement chip needs a name before any device
// evidence exists to name it from.
const CLUSTER_NAMES = {
  "0x0006": "On/Off",
  "0x0008": "Level Control (dimming)",
  "0x0300": "Color Control",
};

let INDEX = [];
let mode = null; // "nl" | "guided"

// ---- Guided wizard state ----
const wizard = {
  goals: new Set(),
  directBinding: "dontcare", // "yes" | "no" | "dontcare"
  powerPref: "dontcare", // "battery" | "mains" | "dontcare"
  channelsPref: "",
  manufacturerPref: "",
};

// ---- NL mode state ----
// A plain object (not tied to any input control) so a chip removed after
// parsing can be edited independently of the text the user actually typed
// — re-running parseNaturalLanguageQuery() on removal would just resurrect
// whatever the text still says.
let nlRequirements = null;

function starsHtml(rating) {
  if (rating.conflicting) {
    return `<span class="trust-stars trust-conflict" title="Community confidence: the community's own scans disagree with each other for this device">⚠ Conflicting</span>`;
  }
  const filled = "★".repeat(rating.stars);
  const empty = "☆".repeat(5 - rating.stars);
  return `<span class="trust-stars" title="Community confidence: ${rating.stars}/5, based on ${rating.totalScans} scan${
    rating.totalScans === 1 ? "" : "s"
  }">${filled}${empty}</span>`;
}

// ---- Requirements -> chip list (shared by both modes) ----
function requirementsToChips(req) {
  const chips = [];
  (req.clusters || []).forEach((c) => {
    const name = CLUSTER_NAMES[c.id] || c.id;
    chips.push({
      key: `cluster:${c.id}`,
      label: c.direction === "output" ? `${name} — Output (direct control)` : name,
    });
  });
  if (req.anyOutput) chips.push({ key: "anyOutput", label: "Can control another device directly" });
  if (req.measuresPower) chips.push({ key: "measuresPower", label: "Measures electrical power" });
  if (req.powerSource) {
    chips.push({ key: "powerSource", label: req.powerSource === "battery" ? "Battery powered" : "Mains powered" });
  }
  if (req.minChannels) chips.push({ key: "minChannels", label: `${req.minChannels}+ buttons / channels` });
  if (req.manufacturer) chips.push({ key: "manufacturer", label: `Manufacturer: ${req.manufacturer}` });
  return chips;
}

function buildRequirementsFromWizard() {
  const req = { clusters: [] };
  const clusterIds = new Set();
  let anyOutput = false;
  let measuresPower = false;
  wizard.goals.forEach((id) => {
    const g = FIND_GOAL_OPTIONS.find((o) => o.id === id);
    if (!g) return;
    if (g.clusterId) clusterIds.add(g.clusterId);
    if (g.anyOutput) anyOutput = true;
    if (g.measuresPower) measuresPower = true;
  });
  const direction = wizard.directBinding === "yes" ? "output" : "either";
  clusterIds.forEach((id) => req.clusters.push({ id, direction }));
  if (anyOutput) req.anyOutput = true;
  if (measuresPower) req.measuresPower = true;
  if (wizard.powerPref !== "dontcare") req.powerSource = wizard.powerPref;
  if (wizard.channelsPref) req.minChannels = parseInt(wizard.channelsPref, 10);
  if (wizard.manufacturerPref.trim()) req.manufacturer = wizard.manufacturerPref.trim();
  return req;
}

function hasAnyHardFilter(req) {
  return !!((req.clusters && req.clusters.length) || req.anyOutput || req.measuresPower);
}

// ---- Removing a chip ----
// Guided mode: mutate the underlying wizard state (and sync the visible
// controls) so the wizard and the chip list can never disagree with each
// other. NL mode: there's no control to sync — just drop the field from
// the standalone parsed-requirements object.
function removeChip(key) {
  if (mode === "guided") {
    if (key.startsWith("cluster:")) {
      const clusterId = key.slice("cluster:".length);
      FIND_GOAL_OPTIONS.filter((g) => g.clusterId === clusterId).forEach((g) => wizard.goals.delete(g.id));
    } else if (key === "anyOutput") {
      wizard.goals.delete("control-directly");
    } else if (key === "measuresPower") {
      wizard.goals.delete("measure-power");
    } else if (key === "powerSource") {
      wizard.powerPref = "dontcare";
    } else if (key === "minChannels") {
      wizard.channelsPref = "";
    } else if (key === "manufacturer") {
      wizard.manufacturerPref = "";
    }
    syncWizardControls();
    renderWizardStep1Selection();
    renderRequirementsAndMaybeRematch();
  } else if (mode === "nl" && nlRequirements) {
    if (key.startsWith("cluster:")) {
      const clusterId = key.slice("cluster:".length);
      nlRequirements.clusters = (nlRequirements.clusters || []).filter((c) => c.id !== clusterId);
    } else {
      delete nlRequirements[key];
    }
    renderRequirementsAndMaybeRematch();
  }
}

function syncWizardControls() {
  document.querySelectorAll('input[name="find-direct"]').forEach((el) => {
    el.checked = el.value === wizard.directBinding;
  });
  document.getElementById("find-power-pref").value = wizard.powerPref;
  document.getElementById("find-channels-pref").value = wizard.channelsPref;
  document.getElementById("find-manufacturer-pref").value = wizard.manufacturerPref;
  updateChannelsVisibility();
}

function updateChannelsVisibility() {
  const anyClusterGoal = [...wizard.goals].some((id) => {
    const g = FIND_GOAL_OPTIONS.find((o) => o.id === id);
    return g && g.clusterId;
  });
  document.getElementById("find-channels-wrap").hidden = !anyClusterGoal;
}

function renderWizardStep1Selection() {
  document.querySelectorAll("#find-goal-grid .find-goal-btn").forEach((btn) => {
    btn.classList.toggle("selected", wizard.goals.has(btn.dataset.goalId));
    btn.setAttribute("aria-pressed", wizard.goals.has(btn.dataset.goalId) ? "true" : "false");
  });
}

let resultsCurrentlyShown = false;

function renderRequirementsAndMaybeRematch() {
  const req = mode === "guided" ? buildRequirementsFromWizard() : nlRequirements;
  const section = document.getElementById("find-requirements-section");
  const chipsEl = document.getElementById("find-req-chips");
  const showBtn = document.getElementById("find-show-matches");

  if (!req || !hasAnyHardFilter(req)) {
    section.hidden = true;
    document.getElementById("find-results-section").hidden = true;
    resultsCurrentlyShown = false;
    return;
  }

  section.hidden = false;
  const chips = requirementsToChips(req);
  chipsEl.innerHTML = chips
    .map(
      (c) =>
        `<span class="find-chip">${escapeHtml(c.label)} <button type="button" class="find-chip-remove" data-key="${escapeHtml(
          c.key
        )}" aria-label="Remove">&times;</button></span>`
    )
    .join("");
  showBtn.textContent = resultsCurrentlyShown ? "Update matches" : "Show matches";

  if (resultsCurrentlyShown) runMatch(req);
}

function evidenceListHtml(clusterEvidence) {
  if (!clusterEvidence.length) return "";
  return `<ul class="find-evidence-list">${clusterEvidence
    .map((c) => {
      const name = CLUSTER_NAMES[c.req.id] || c.req.id;
      const wantLabel = c.req.direction === "output" ? `${name} — Output` : name;
      return `<li>${c.met ? "✓" : "✗"} ${escapeHtml(wantLabel)} <span class="muted">— ${
        c.met ? `confirmed (${escapeHtml(c.group.label)})` : "not observed in community scans"
      }</span></li>`;
    })
    .join("")}</ul>`;
}

function resultCardHtml(m) {
  const key = `${m.manufacturerSlug}|${m.modelSlug}`;
  const params = new URLSearchParams({ manufacturer: m.manufacturer || "", model: m.model || "" });
  const powerLine =
    m.powerSource && m.powerSource !== "unknown"
      ? `<p class="find-result-power muted">Power: ${
          m.powerSource === "both" ? "battery and mains evidence seen" : m.powerSource
        }</p>`
      : "";
  const channelsLine =
    m.channelCount != null ? `<p class="find-result-power muted">Channels confirmed: ${m.channelCount}</p>` : "";
  return `
    <div class="device-card" data-key="${escapeHtml(key)}">
      <div class="device-card-header">${escapeHtml(m.manufacturer || "—")} ${escapeHtml(m.model || "—")}</div>
      <div class="trust-panel">
        ${starsHtml(m.rating)}
      </div>
      ${evidenceListHtml(m.clusterEvidence)}
      ${powerLine}
      ${channelsLine}
      <a class="btn btn-small" href="index.html?${params.toString()}#search-section">View device &rarr;</a>
    </div>`;
}

function runMatch(req) {
  resultsCurrentlyShown = true;
  const { full, partial } = matchGuidedSearch(INDEX, req);
  const resultsSection = document.getElementById("find-results-section");
  const countEl = document.getElementById("find-results-count");
  const fullEl = document.getElementById("find-results-full");
  const partialWrap = document.getElementById("find-results-partial-wrap");
  const partialEl = document.getElementById("find-results-partial");
  const noResultsEl = document.getElementById("find-no-results");

  resultsSection.hidden = false;

  if (!full.length && !partial.length) {
    countEl.textContent = "";
    fullEl.innerHTML = "";
    partialWrap.hidden = true;
    noResultsEl.hidden = false;
    noResultsEl.innerHTML = `<div class="empty-search">
      <p>None of the devices currently in the community database have observations confirming all of these requirements.</p>
      <p class="muted">This does not mean no Zigbee device supports them — only that we don't currently have the
        community evidence. Try removing a requirement above, or contribute a scan if you already own a device you
        think should match.</p>
      <a class="btn" href="index.html#contribute">Contribute a scan</a>
    </div>`;
    return;
  }

  noResultsEl.hidden = true;
  countEl.textContent = `${full.length} full match${full.length === 1 ? "" : "es"}${
    partial.length ? `, ${partial.length} partial match${partial.length === 1 ? "" : "es"}` : ""
  }`;
  fullEl.innerHTML = full.map(resultCardHtml).join("");
  if (partial.length) {
    partialWrap.hidden = false;
    partialEl.innerHTML = partial.map(resultCardHtml).join("");
  } else {
    partialWrap.hidden = true;
    partialEl.innerHTML = "";
  }
}

// ---- Mode switching ----
function setMode(newMode) {
  mode = newMode;
  document.getElementById("find-nl-section").hidden = mode !== "nl";
  document.getElementById("find-wizard-section").hidden = mode !== "guided";
  document.querySelectorAll(".find-mode-btn").forEach((btn) => {
    btn.classList.toggle("selected", btn.dataset.mode === mode);
  });
  if (mode === "guided") {
    renderRequirementsAndMaybeRematch();
  } else {
    // Switching to NL mode with no query typed yet shouldn't show a stale
    // guided-mode requirements/results panel.
    if (!nlRequirements) {
      document.getElementById("find-requirements-section").hidden = true;
      document.getElementById("find-results-section").hidden = true;
      resultsCurrentlyShown = false;
    } else {
      renderRequirementsAndMaybeRematch();
    }
  }
}

const NL_EXAMPLES = [
  "Find a remote that can directly dim lights",
  "Find a 3-gang switch",
  "Find devices that measure power",
  "Find a battery button that works without Home Assistant",
  "Find a mains powered switch that can control colour temperature",
];

function renderGoalGrid() {
  const grid = document.getElementById("find-goal-grid");
  grid.innerHTML = FIND_GOAL_OPTIONS.map(
    (g) =>
      `<button type="button" class="find-goal-btn" data-goal-id="${escapeHtml(g.id)}" aria-pressed="false">${escapeHtml(
        g.label
      )}</button>`
  ).join("");
  grid.querySelectorAll(".find-goal-btn").forEach((btn) => {
    btn.addEventListener("click", () => {
      const id = btn.dataset.goalId;
      if (wizard.goals.has(id)) wizard.goals.delete(id);
      else wizard.goals.add(id);
      renderWizardStep1Selection();
      updateChannelsVisibility();
      renderRequirementsAndMaybeRematch();
    });
  });

  const redirects = document.getElementById("find-goal-redirects");
  redirects.innerHTML = FIND_GOAL_REDIRECTS.map(
    (r) => `<a class="chip" href="${escapeHtml(r.href)}">${escapeHtml(r.label)}</a>`
  ).join("");
}

function wireWizardControls() {
  document.querySelectorAll('input[name="find-direct"]').forEach((el) => {
    el.addEventListener("change", (e) => {
      wizard.directBinding = e.target.value;
      renderRequirementsAndMaybeRematch();
    });
  });
  document.getElementById("find-power-pref").addEventListener("change", (e) => {
    wizard.powerPref = e.target.value;
    renderRequirementsAndMaybeRematch();
  });
  document.getElementById("find-channels-pref").addEventListener("change", (e) => {
    wizard.channelsPref = e.target.value;
    renderRequirementsAndMaybeRematch();
  });
  document.getElementById("find-manufacturer-pref").addEventListener("input", (e) => {
    wizard.manufacturerPref = e.target.value;
    renderRequirementsAndMaybeRematch();
  });
}

function wireNlMode() {
  const examplesEl = document.getElementById("find-nl-examples");
  examplesEl.innerHTML = NL_EXAMPLES.map((ex) => `<button type="button" class="chip">${escapeHtml(ex)}</button>`).join(
    ""
  );
  examplesEl.querySelectorAll(".chip").forEach((btn) => {
    btn.addEventListener("click", () => {
      document.getElementById("find-nl-input").value = btn.textContent;
      handleNlSubmit();
    });
  });

  document.getElementById("find-nl-form").addEventListener("submit", (e) => {
    e.preventDefault();
    handleNlSubmit();
  });
}

function handleNlSubmit() {
  const text = document.getElementById("find-nl-input").value;
  const feedbackEl = document.getElementById("find-nl-feedback");
  if (!text.trim()) {
    feedbackEl.innerHTML = "";
    return;
  }
  const parsed = parseNaturalLanguageQuery(text);
  if (!hasAnyHardFilter(parsed.requirements)) {
    feedbackEl.innerHTML = `<p class="hint">We couldn't confidently match anything specific in that description. Try
      rephrasing with a capability like "dim", "switch on/off", "colour", or "measure power" — or use
      <button type="button" class="find-linklike" id="find-switch-to-guided">Build your search</button> instead.</p>`;
    document.getElementById("find-switch-to-guided").addEventListener("click", () => setMode("guided"));
    nlRequirements = null;
    document.getElementById("find-requirements-section").hidden = true;
    document.getElementById("find-results-section").hidden = true;
    resultsCurrentlyShown = false;
    return;
  }
  feedbackEl.innerHTML = "";
  nlRequirements = parsed.requirements;
  resultsCurrentlyShown = false;
  renderRequirementsAndMaybeRematch();
  runMatch(nlRequirements);
}

async function init() {
  try {
    INDEX = await fetchCapabilityIndex();
  } catch (err) {
    document.getElementById("find-nl-section").hidden = false;
    document.getElementById("find-nl-section").innerHTML = `<p class="muted">Couldn't load the community database (${escapeHtml(
      err && err.message ? err.message : String(err)
    )}). Try reloading.</p>`;
    return;
  }

  renderGoalGrid();
  wireWizardControls();
  wireNlMode();
  updateChannelsVisibility();

  document.querySelectorAll(".find-mode-btn").forEach((btn) => {
    btn.addEventListener("click", () => setMode(btn.dataset.mode));
  });

  document.getElementById("find-req-chips").addEventListener("click", (e) => {
    const btn = e.target.closest(".find-chip-remove");
    if (!btn) return;
    removeChip(btn.dataset.key);
  });

  document.getElementById("find-show-matches").addEventListener("click", () => {
    const req = mode === "guided" ? buildRequirementsFromWizard() : nlRequirements;
    if (req) runMatch(req);
  });

  setMode("nl");
}

init();
