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

async function copyText(text, btn) {
  const original = btn.textContent;
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
    btn.textContent = "Copied ✓";
  } catch (e) {
    btn.textContent = "Copy failed — select & copy manually";
  }
  setTimeout(() => { btn.textContent = original; }, 2200);
}

function referencesSnippet(obj) {
  return JSON.stringify(obj, null, 2);
}

function copyRow(label, snippet, hint) {
  const wrap = document.createElement("div");
  wrap.className = "review-copy-row";
  const btn = document.createElement("button");
  btn.type = "button";
  btn.className = "btn btn-copy";
  btn.textContent = label;
  btn.addEventListener("click", () => copyText(snippet, btn));
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
  head.textContent = `${manufacturer} ${model}`;
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
  if (!items.length) return;
  document.getElementById("mfr-only-section").hidden = false;
  toolbarEl.appendChild(
    linkRow([{ label: `Open the review PR (${items.length} pending) →`, url: PR_SEARCH_URL }])
  );
  for (const item of items) {
    const card = cardShell(item.manufacturer, item.model, null);
    const p = document.createElement("p");
    p.className = "review-links-list";
    p.innerHTML =
      `Blakadder: <a href="${escapeHtml(item.blakadderUrl)}" target="_blank" rel="noopener noreferrer">${escapeHtml(item.blakadderUrl)}</a><br>` +
      `Proposed manufacturer link: <a href="${escapeHtml(item.guessedUrl)}" target="_blank" rel="noopener noreferrer">${escapeHtml(item.guessedUrl)}</a>`;
    card.appendChild(p);
    card.appendChild(
      linkRow([
        { label: "View this device on GitHub →", url: githubBlobUrl(item.file) },
      ])
    );
    card.appendChild(
      copyRow(
        "Copy “not this link” fix",
        referencesSnippet({ manufacturer_declined: true }),
        `To decline just this manufacturer link (keeping the Blakadder match): open ${item.file} on GitHub, and inside the existing "references" object add the copied line. Approving is simpler — just merge the PR above.`
      )
    );
    listEl.appendChild(card);
  }
}

function renderAmbiguous(items, listEl) {
  if (!items.length) return;
  document.getElementById("ambiguous-section").hidden = false;
  for (const item of items) {
    const card = cardShell(item.manufacturer, item.model, item.reason);
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
      btn.addEventListener("click", () =>
        copyText(
          referencesSnippet({
            blakadder: { url: cand.url, match_method: "manual", confidence: "high" },
            checked_manufacturer: item.manufacturer,
            checked_model: item.model,
          }),
          btn
        )
      );
      row.appendChild(btn);
      candList.appendChild(row);
    }
    card.appendChild(candList);
    card.appendChild(
      linkRow([{ label: `Edit ${item.file} on GitHub →`, url: githubEditUrl(item.file) }])
    );
    card.appendChild(
      copyRow(
        "Copy “none of these” fix",
        referencesSnippet({
          blakadder: null,
          checked_manufacturer: item.manufacturer,
          checked_model: item.model,
          blakadder_declined: true,
        }),
        `Set the device's "references" key to the copied value to permanently stop suggesting a Blakadder match for this device.`
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
    card.appendChild(
      copyRow(
        "Copy “accept new match” fix",
        referencesSnippet({
          blakadder: { url: item.newUrl, match_method: "manual", confidence: "high" },
          checked_manufacturer: item.manufacturer,
          checked_model: item.model,
        }),
        "Replaces the device's \"references\" value with the newly-found match."
      )
    );
    card.appendChild(
      copyRow(
        "Copy “keep current, stop asking” fix",
        referencesSnippet({ blakadder_declined: true }),
        `Keeps ${item.previousUrl} and stops future rechecks — add the copied line inside the device's existing "references" object.`
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
    const mfrOnly = all.filter((r) => r.kind === "manufacturer_link_only");
    const ambiguous = all.filter((r) => r.kind === "blakadder_ambiguous");
    const matchChanged = all.filter((r) => r.kind === "match_changed");
    const deadLinks = all.filter((r) => r.kind === "dead_link");

    if (!all.length) {
      statsEl.textContent = "Nothing awaiting review right now.";
      document.getElementById("empty-state").hidden = false;
      return;
    }

    statsEl.textContent =
      `Generated ${new Date(data.generated_at).toLocaleString()} — ${mfrOnly.length} ready to approve, ` +
      `${ambiguous.length} need a decision, ${matchChanged.length} match changed, ${deadLinks.length} dead link(s) found.`;

    renderMfrOnly(mfrOnly, document.getElementById("mfr-only-list"), document.getElementById("mfr-only-toolbar"));
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
