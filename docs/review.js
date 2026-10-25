// External reference review queue — read-only browsing aid over
// references-review.json (see .github/workflows/enrich-external-references.yml
// for how that file gets generated). This page has no backend of its own:
// it fetches the report straight from the review branch on
// raw.githubusercontent.com, and every action it offers ends in either a
// link to GitHub (to merge the standing PR, or to open a device file in
// GitHub's own editor) or a "copy" button that puts the exact JSON to
// paste into clipboard — it never writes anything back itself.
import { CAPABILITY_DB_REPO } from "./capexplorer-constants.js";

const REVIEW_BRANCH = "automation/external-references-review";
const REVIEW_URL = `https://raw.githubusercontent.com/${CAPABILITY_DB_REPO}/${REVIEW_BRANCH}/references-review.json`;
const PR_SEARCH_URL = `https://github.com/${CAPABILITY_DB_REPO}/pulls?q=${encodeURIComponent(`is:pr is:open head:${REVIEW_BRANCH}`)}`;
const RAW_MAIN_URL = (file) => `https://raw.githubusercontent.com/${CAPABILITY_DB_REPO}/main/${file}`;

// Same pattern/label as app.js's manufacturerDisplayLabel — intentionally
// duplicated rather than imported (this page and the main site don't
// otherwise share code, and it's 3 lines) rather than pulled from
// capexplorer-constants.js, which is the card's own copied-verbatim
// source of truth and shouldn't gain website-only concepts.
const GENERIC_TUYA_LABEL = "Generic Tuya";
const TUYA_MANUFACTURER_PATTERN = /^_T[A-Z0-9]+_/i;
function manufacturerDisplayLabel(m) {
  if (!m) return "—";
  return TUYA_MANUFACTURER_PATTERN.test(m) ? `${GENERIC_TUYA_LABEL} (${m})` : m;
}

function escapeHtml(s) {
  return String(s == null ? "" : s).replace(/[&<>"']/g, (c) => ({
    "&": "&amp;",
    "<": "&lt;",
    ">": "&gt;",
    '"': "&quot;",
    "'": "&#39;",
  }[c]));
}

function githubEditUrl(file) {
  return `https://github.com/${CAPABILITY_DB_REPO}/edit/main/${file}`;
}

function githubBlobUrl(file) {
  return `https://github.com/${CAPABILITY_DB_REPO}/blob/main/${file}`;
}

async function copyText(text, btn, successMessage, revertTo) {
  const original = revertTo || btn.textContent;
  try {
    if (navigator.clipboard && window.isSecureContext) {
      await navigator.clipboard.writeText(text);
    } else {
      const ta = document.createElement("textarea");
      ta.value = text;
      ta.style.position = "fixed";
      ta.style.opacity = "0";
      document.body.appendChild(ta);
      ta.select();
      document.execCommand("copy");
      document.body.removeChild(ta);
    }
    btn.textContent = successMessage || "Copied ✓";
  } catch (e) {
    btn.textContent = "Copy failed — select & copy manually";
  }
  setTimeout(() => { btn.textContent = original; }, 2500);
}

// Fetches the device's CURRENT file content fresh (not whatever was true
// when the report was generated — another fix could have landed on `main`
// since), splices in the new "references" value, and returns the complete
// file as pretty-printed text ready to paste over the whole file. This is
// the difference between "here's a JSON fragment, go find where it goes"
// and "select all, paste, done" — GitHub's own editor UI has no way to
// pre-fill an *edit* of an existing file via URL (only brand-new files
// support that), so a full-file clipboard copy is the closest this
// no-backend page can get to a one-click fix.
async function buildFullFileFix(file, mode, patch) {
  const res = await fetch(RAW_MAIN_URL(file), { cache: "no-store" });
  if (!res.ok) throw new Error(`couldn't fetch current file (HTTP ${res.status})`);
  const parsed = await res.json();
  parsed.references = mode === "merge" ? Object.assign({}, parsed.references || {}, patch) : patch;
  return JSON.stringify(parsed, null, 2) + "\n";
}

// mode: "replace" sets the device's whole "references" key to `patch`;
// "merge" keeps whatever's already there and adds/overwrites just the
// keys in `patch` (used for the decline flags, which shouldn't disturb an
// already-correct blakadder/manufacturer value sitting alongside them).
function attachCopyFullFileHandler(btn, file, mode, patch) {
  btn.addEventListener("click", async () => {
    const original = btn.textContent;
    btn.disabled = true;
    btn.textContent = "Fetching current file…";
    try {
      const fullText = await buildFullFileFix(file, mode, patch);
      await copyText(fullText, btn, "Copied whole file ✓", original);
    } catch (e) {
      btn.textContent = "Couldn't fetch — use Edit on GitHub instead";
      setTimeout(() => { btn.textContent = original; }, 3000);
    } finally {
      btn.disabled = false;
    }
  });
}

function copyFullFileRow(label, file, mode, patch, hint) {
  const wrap = document.createElement("div");
  wrap.className = "review-copy-row";
  const btn = document.createElement("button");
  btn.type = "button";
  btn.className = "btn btn-copy";
  btn.textContent = label;
  attachCopyFullFileHandler(btn, file, mode, patch);
  wrap.appendChild(btn);
  if (hint) {
    const p = document.createElement("p");
    p.className = "hint";
    p.textContent = hint;
    wrap.appendChild(p);
  }
  return wrap;
}

function linkRow(items) {
  const wrap = document.createElement("div");
  wrap.className = "review-link-row";
  for (const { label, url } of items) {
    const a = document.createElement("a");
    a.className = "btn btn-secondary";
    a.href = url;
    a.target = "_blank";
    a.rel = "noopener noreferrer";
    a.textContent = label;
    wrap.appendChild(a);
  }
  return wrap;
}

function cardShell(manufacturer, model, reason) {
  const card = document.createElement("div");
  card.className = "device-card review-card";
  const head = document.createElement("div");
  head.className = "device-card-header";
  head.textContent = `${manufacturerDisplayLabel(manufacturer)} ${model}`;
  card.appendChild(head);
  if (reason) {
    const r = document.createElement("p");
    r.className = "hint review-reason";
    r.textContent = reason;
    card.appendChild(r);
  }
  return card;
}

function renderMfrOnly(items, listEl, toolbarEl) {
  // Two kinds share this section: manufacturer_link_only (from a solid
  // Blakadder match) and manufacturer_link_search (found by vendor
  // search, no Blakadder involvement). Both are pre-filled on the review
  // PR the same way, so approving/declining works identically.
  if (!items.length) return;
  document.getElementById("mfr-only-section").hidden = false;
  // One obvious action for the common case: every link here is already
  // filled in on the review PR, so approving = merging it. Nothing to copy
  // or paste unless a link is wrong.
  const howTo = document.createElement("div");
  howTo.className = "review-approve-box";
  howTo.innerHTML =
    `<p><strong>To approve all ${items.length} link(s): nothing to copy or paste.</strong> They're already filled in on the review pull request — open it, then click the green <strong>Merge pull request</strong> button (and <strong>Confirm merge</strong>). They go live on the site a few minutes later.</p>`;
  const prBtn = document.createElement("a");
  prBtn.className = "btn";
  prBtn.href = PR_SEARCH_URL;
  prBtn.target = "_blank";
  prBtn.rel = "noopener noreferrer";
  prBtn.textContent = `Open the review pull request →`;
  howTo.appendChild(prBtn);
  const after = document.createElement("p");
  after.className = "hint";
  after.textContent = "Only if a link below is wrong: use “This link is wrong” on that card first, then merge.";
  howTo.appendChild(after);
  toolbarEl.appendChild(howTo);

  for (const item of items) {
    const card = cardShell(item.manufacturer, item.model, null);
    const p = document.createElement("p");
    p.className = "review-links-list";
    p.innerHTML =
      `<a href="${escapeHtml(item.guessedUrl)}" target="_blank" rel="noopener noreferrer">${escapeHtml(item.title || item.guessedUrl)}</a>` +
      (item.title ? `<br><span class="muted">${escapeHtml(item.guessedUrl)}</span>` : "") +
      `<br><span class="muted">${
        item.blakadderUrl
          ? `From Blakadder: <a href="${escapeHtml(item.blakadderUrl)}" target="_blank" rel="noopener noreferrer">${escapeHtml(item.blakadderUrl)}</a>`
          : `Found by ${escapeHtml(item.method || "vendor search")}${item.evidence ? ` — ${escapeHtml(item.evidence)}` : ""}`
      }</span>`;
    card.appendChild(p);

    // Declining is the rare path, so it's tucked away.
    const det = document.createElement("details");
    det.className = "review-decline";
    const sum = document.createElement("summary");
    sum.textContent = "This link is wrong";
    det.appendChild(sum);
    const steps = document.createElement("p");
    steps.className = "hint";
    steps.textContent = "1. Click “Copy fix” (copies the whole device file with this link ruled out). 2. Click “Edit on GitHub”. 3. Select all (Cmd/Ctrl+A), paste, and commit. Then merge the review pull request as usual — this device will be left out.";
    det.appendChild(steps);
    const row = document.createElement("div");
    row.className = "review-link-row";
    const btn = document.createElement("button");
    btn.type = "button";
    btn.className = "btn btn-copy";
    btn.textContent = "Copy fix";
    attachCopyFullFileHandler(btn, item.file, "merge", { manufacturer_declined: true });
    row.appendChild(btn);
    const a = document.createElement("a");
    a.className = "btn btn-secondary";
    a.href = githubEditUrl(item.file);
    a.target = "_blank";
    a.rel = "noopener noreferrer";
    a.textContent = "Edit on GitHub →";
    row.appendChild(a);
    det.appendChild(row);
    card.appendChild(det);
    listEl.appendChild(card);
  }
}

const BLAKADDER_FIELD_LABELS = [
  ["manufacturer", "Manufacturer"],
  ["deviceName", "Device name"],
  ["model", "Model"],
  ["zigbeeId", "ZigbeeID"],
  ["category", "Device Category"],
  ["vendorLink", "Vendor Link"],
  ["manufacturerLink", "Manufacturer Link (optional)"],
  ["gateways", "Supported Gateways"],
  ["description", "Description (optional)"],
  ["notes", "Notes to maintainers (optional)"],
];

function blakadderFieldsTable(fields) {
  const wrap = document.createElement("div");
  wrap.className = "table-scroll blk-fields";
  const table = document.createElement("table");
  for (const [key, label] of BLAKADDER_FIELD_LABELS) {
    const raw = fields[key];
    const value = Array.isArray(raw) ? raw.join(", ") : raw || "";
    const tr = document.createElement("tr");
    const th = document.createElement("td");
    th.className = "blk-label";
    th.textContent = label;
    const td = document.createElement("td");
    if (!value) {
      td.className = "blk-empty";
      td.textContent = "(leave empty)";
    } else if (/^https?:\/\//.test(value)) {
      const a = document.createElement("a");
      a.href = value;
      a.target = "_blank";
      a.rel = "noopener noreferrer";
      a.textContent = value;
      td.appendChild(a);
    } else {
      td.textContent = value;
    }
    const tdCopy = document.createElement("td");
    tdCopy.className = "blk-copy";
    if (value && key !== "gateways" && key !== "category") {
      const btn = document.createElement("button");
      btn.type = "button";
      btn.className = "btn btn-copy btn-small";
      btn.textContent = "Copy";
      btn.addEventListener("click", () => copyText(value, btn, "Copied ✓"));
      tdCopy.appendChild(btn);
    }
    tr.append(th, td, tdCopy);
    table.appendChild(tr);
  }
  wrap.appendChild(table);
  return wrap;
}

function renderBlakadderSubmissions(items, incomplete, listEl) {
  if (!items.length && !incomplete.length) return;
  document.getElementById("blakadder-submit-section").hidden = false;
  const today = new Date().toISOString().slice(0, 10);
  for (const item of items) {
    const card = cardShell(item.fields.manufacturer || item.manufacturer, item.fields.model || item.model, null);
    if (item.manufacturerLinkPending) {
      const w = document.createElement("p");
      w.className = "review-warning";
      w.textContent = "The manufacturer link below was found by vendor search and is still waiting for approval in “Ready to approve” above — check that it's the right page before submitting.";
      card.appendChild(w);
    }
    card.appendChild(blakadderFieldsTable(item.fields));
    const links = [];
    if (item.prefillUrl) links.push({ label: "Open pre-filled Blakadder form →", url: item.prefillUrl });
    links.push({ label: "View this device on GitHub →", url: githubBlobUrl(item.file) });
    links.push({ label: `Edit ${item.file} on GitHub →`, url: githubEditUrl(item.file) });
    card.appendChild(linkRow(links));
    card.appendChild(
      copyFullFileRow(
        "Copy “mark as submitted” fix",
        item.file, "merge", { blakadder_submitted: today },
        `After submitting: copies the whole file with blakadder_submitted: "${today}" added, so this draft stops showing here. Click "Edit" above, select all (Ctrl/Cmd+A), paste, commit.`
      )
    );
    listEl.appendChild(card);
  }
  if (incomplete.length) {
    const det = document.getElementById("blakadder-incomplete");
    det.hidden = false;
    document.getElementById("blakadder-incomplete-summary").textContent = `${incomplete.length} more device(s) not on Blakadder, not enough info for a draft yet`;
    const ul = document.getElementById("blakadder-incomplete-list");
    for (const item of incomplete) {
      const li = document.createElement("li");
      const a = document.createElement("a");
      a.href = githubBlobUrl(item.file);
      a.target = "_blank";
      a.rel = "noopener noreferrer";
      a.textContent = `${manufacturerDisplayLabel(item.manufacturer)} ${item.model}`;
      li.appendChild(a);
      li.appendChild(document.createTextNode(` — missing: ${(item.missing || []).join(", ")}`));
      ul.appendChild(li);
    }
  }
}

function renderAmbiguous(items, listEl) {
  if (!items.length) return;
  document.getElementById("ambiguous-section").hidden = false;
  for (const item of items) {
    const card = cardShell(item.manufacturer, item.model, item.reason);
    const instructions = document.createElement("p");
    instructions.className = "hint";
    instructions.textContent = `Recognize the device? Click that candidate's "Copy fix for this one", then "Edit ${item.file} on GitHub" below, select all (Ctrl/Cmd+A), paste, commit.`;
    card.appendChild(instructions);
    const candList = document.createElement("div");
    candList.className = "review-candidates";
    for (const cand of item.candidates || []) {
      const row = document.createElement("div");
      row.className = "review-candidate-row";
      const a = document.createElement("a");
      a.href = cand.url;
      a.target = "_blank";
      a.rel = "noopener noreferrer";
      a.textContent = cand.url;
      row.appendChild(a);
      const meta = document.createElement("span");
      meta.className = "muted review-candidate-meta";
      meta.textContent = ` — vendor "${cand.vendor || ""}", model "${cand.model || ""}"`;
      row.appendChild(meta);
      const btn = document.createElement("button");
      btn.type = "button";
      btn.className = "btn btn-copy btn-small";
      btn.textContent = "Copy fix for this one";
      attachCopyFullFileHandler(btn, item.file, "replace", {
        blakadder: { url: cand.url, match_method: "manual", confidence: "high" },
        checked_manufacturer: item.manufacturer,
        checked_model: item.model,
      });
      row.appendChild(btn);
      candList.appendChild(row);
    }
    card.appendChild(candList);
    card.appendChild(
      linkRow([{ label: `Edit ${item.file} on GitHub →`, url: githubEditUrl(item.file) }])
    );
    card.appendChild(
      copyFullFileRow(
        "Copy “none of these” fix",
        item.file, "replace",
        {
          blakadder: null,
          checked_manufacturer: item.manufacturer,
          checked_model: item.model,
          blakadder_declined: true,
        },
        `Copies the whole file with this permanently applied — click "Edit" above, select all (Ctrl/Cmd+A), paste, commit.`
      )
    );
    listEl.appendChild(card);
  }
}

function renderMatchChanged(items, listEl) {
  if (!items.length) return;
  document.getElementById("match-changed-section").hidden = false;
  for (const item of items) {
    const card = cardShell(item.manufacturer, item.model, item.reason);
    card.appendChild(
      linkRow([{ label: `Edit ${item.file} on GitHub →`, url: githubEditUrl(item.file) }])
    );
    if (item.newUrl) {
      card.appendChild(
        copyFullFileRow(
          "Copy “accept new match” fix",
          item.file, "replace",
          {
            blakadder: { url: item.newUrl, match_method: "manual", confidence: "high" },
            checked_manufacturer: item.manufacturer,
            checked_model: item.model,
          },
          "Copies the whole file with the newly-found match applied — click \"Edit\" above, select all (Ctrl/Cmd+A), paste, commit."
        )
      );
    }
    // No newUrl means a recheck stopped finding any match at all for a
    // device that already had one (Blakadder's own data likely shifted) —
    // there's nothing to "accept", just the choice to keep what's there.
    card.appendChild(
      copyFullFileRow(
        "Copy “keep current, stop asking” fix",
        item.file, "merge", { blakadder_declined: true },
        `Copies the whole file, keeping ${item.previousUrl} exactly as it is and stopping future rechecks — same paste-and-commit steps as above.`
      )
    );
    listEl.appendChild(card);
  }
}

function renderDeadLinks(items, listEl) {
  if (!items.length) return;
  document.getElementById("dead-link-section").hidden = false;
  for (const item of items) {
    const card = cardShell(item.manufacturer, item.model, item.reason);
    card.appendChild(
      linkRow([{ label: `Edit ${item.file} on GitHub →`, url: githubEditUrl(item.file) }])
    );
    listEl.appendChild(card);
  }
}

async function main() {
  const statsEl = document.getElementById("review-stats");
  try {
    const res = await fetch(REVIEW_URL, { cache: "no-store" });
    if (res.status === 404) {
      statsEl.textContent = "No review is currently open.";
      document.getElementById("empty-state").hidden = false;
      return;
    }
    if (!res.ok) throw new Error(`HTTP ${res.status}`);
    const data = await res.json();
    const all = data.ambiguous || [];
    const mfrOnly = all.filter((r) => r.kind === "manufacturer_link_only" || r.kind === "manufacturer_link_search");
    const blkDrafts = all.filter((r) => r.kind === "blakadder_submission");
    const blkIncomplete = all.filter((r) => r.kind === "blakadder_submission_incomplete");
    const ambiguous = all.filter((r) => r.kind === "blakadder_ambiguous");
    const matchChanged = all.filter((r) => r.kind === "match_changed");
    const deadLinks = all.filter((r) => r.kind === "dead_link");

    if (!all.length) {
      statsEl.textContent = "Nothing awaiting review right now.";
      document.getElementById("empty-state").hidden = false;
      return;
    }

    statsEl.textContent =
      `Generated ${new Date(data.generated_at).toLocaleString()} — ${mfrOnly.length} ready to approve, ${blkDrafts.length} ready to submit to Blakadder, ` +
      `${ambiguous.length} need a decision, ${matchChanged.length} match changed, ${deadLinks.length} dead link(s) found.`;

    renderMfrOnly(mfrOnly, document.getElementById("mfr-only-list"), document.getElementById("mfr-only-toolbar"));
    renderBlakadderSubmissions(blkDrafts, blkIncomplete, document.getElementById("blakadder-submit-list"));
    renderAmbiguous(ambiguous, document.getElementById("ambiguous-list"));
    renderMatchChanged(matchChanged, document.getElementById("match-changed-list"));
    renderDeadLinks(deadLinks, document.getElementById("dead-link-list"));
  } catch (e) {
    statsEl.textContent = "Couldn't load the review queue.";
    document.getElementById("error-state").hidden = false;
    document.getElementById("error-message").textContent =
      `Couldn't load references-review.json from the ${REVIEW_BRANCH} branch (${e.message}). It may not exist yet if no review is currently pending — check the PR list directly: `;
    const a = document.createElement("a");
    a.href = PR_SEARCH_URL;
    a.target = "_blank";
    a.rel = "noopener noreferrer";
    a.textContent = PR_SEARCH_URL;
    document.getElementById("error-message").appendChild(a);
  }
}

main();
