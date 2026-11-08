// Device answers: how a device behaves in real use, answered by the people
// who have one (data/questions.json). Used by ingest-submission.yml (to check
// and clean a submission), rebuild-capability-index.yml (to build
// data/answers.json) and build-issue-form.cjs. Plain Node, no dependencies.
//
// A submission is one person's answers about one physical device:
// {
//   kind: "device_answers", schema: 1, questions_version,
//   manufacturer, model,
//   firmware: { sw_build_id, registry_sw_version, date_code },
//   device_type, use, answers: { <question id>: <answer id> | "other" },
//   other: { <question id or "use">: "text" }, rating: 1..5 | null, tip: "text",
//   context: { system, coordinator, owned_for },
//   card_version, provenance: { submitted_at, source_issue }
// }
// Free text (other, tip) is shown only once a maintainer has merged the PR,
// which is the review.

"use strict";

const fs = require("fs");
const path = require("path");

const SCHEMA = 1;

function loadQuestions(root = ".") {
  return JSON.parse(fs.readFileSync(path.join(root, "data", "questions.json"), "utf8"));
}

/** Removes things that identify a person or a network, then trims to the
 *  limit: Zigbee/IEEE addresses, 0x-numbers longer than a cluster id, IP
 *  addresses, e-mail addresses and links. Cluster/attribute ids (0x0006,
 *  0xE00B) are kept: they're the useful part of a tip. */
function cleanText(value, max = 280) {
  if (typeof value !== "string") return "";
  let s = value
    .replace(/\b[0-9a-f]{2}(?::[0-9a-f]{2}){7}\b/gi, "[address]")
    .replace(/\b0x[0-9a-f]{9,}\b/gi, "[address]")
    .replace(/\b\d{1,3}(?:\.\d{1,3}){3}\b/g, "[address]")
    .replace(/[\w.+-]+@[\w-]+(?:\.[\w-]+)+/g, "[e-mail]")
    .replace(/\bhttps?:\/\/\S+/gi, "[link]")
    .replace(/\bwww\.\S+/gi, "[link]")
    .replace(/[<>]/g, "")
    .replace(/\s+/g, " ")
    .trim();
  if (s.length > max) s = s.slice(0, max - 1).trimEnd() + "…";
  return s;
}

function firmwareKey(fw) {
  if (!fw || typeof fw !== "object") return "unknown";
  return String(fw.sw_build_id || fw.registry_sw_version || "unknown");
}

/** Questions that apply to a device type and use. */
function questionsFor(q, deviceType, use) {
  return (q.questions || []).filter(
    (x) => (x.types || []).includes(deviceType) && (!x.uses || !use || use === "other" || x.uses.includes(use))
  );
}

function useAnswers(q, deviceType) {
  return ((q.use && q.use.answers_by_type) || {})[deviceType] || [];
}

/**
 * Checks and cleans a submission against questions.json. Returns
 * { record, errors, warnings }: errors mean nothing should be imported;
 * warnings are things that were dropped (an unknown question, say) and are
 * worth telling the submitter about.
 */
function validate(input, q) {
  const errors = [];
  const warnings = [];
  if (!input || typeof input !== "object") return { record: null, errors: ["Not a JSON object."], warnings };
  const max = q.free_text_max || 280;
  const str = (v, n = 120) => (typeof v === "string" ? v.trim().slice(0, n) : "");

  const record = {
    kind: "device_answers",
    schema: SCHEMA,
    questions_version: Number.isInteger(input.questions_version) ? input.questions_version : q.version,
    manufacturer: str(input.manufacturer),
    model: str(input.model),
    firmware: {},
    device_type: str(input.device_type, 40),
    use: str(input.use, 60),
    answers: {},
    other: {},
    rating: null,
    tip: "",
    context: {},
  };
  if (!record.manufacturer || !record.model) errors.push("Manufacturer and model are needed.");

  const fw = input.firmware && typeof input.firmware === "object" ? input.firmware : {};
  for (const k of ["sw_build_id", "registry_sw_version", "date_code"]) {
    const v = str(fw[k], 60);
    if (v) record.firmware[k] = v;
  }
  if (!record.firmware.sw_build_id && !record.firmware.registry_sw_version) {
    errors.push("The firmware version is needed: answers are kept per firmware.");
  }

  if (!(q.device_types || []).some((t) => t.id === record.device_type)) {
    errors.push(`Unknown device type "${record.device_type}".`);
  }
  const uses = useAnswers(q, record.device_type).map((a) => a.id);
  const useOther = cleanText(input.other && input.other.use, max);
  if (record.use === "other") {
    if (!useOther) errors.push('"What do you use it for" is Other, but nothing was written.');
    else record.other.use = useOther;
  } else if (!uses.includes(record.use)) {
    errors.push(`"${record.use}" isn't one of the uses for a ${record.device_type}.`);
  }

  const applicable = new Map(questionsFor(q, record.device_type, record.use).map((x) => [x.id, x]));
  const known = new Map((q.questions || []).map((x) => [x.id, x]));
  const answers = input.answers && typeof input.answers === "object" ? input.answers : {};
  for (const [qid, aid] of Object.entries(answers)) {
    const question = applicable.get(qid);
    if (!question) {
      warnings.push(known.has(qid) ? `"${qid}" doesn't apply to this device and use, so it was left out.` : `Unknown question "${qid}" was left out.`);
      continue;
    }
    if (aid === "other" && question.allow_other) {
      const text = cleanText(input.other && input.other[qid], max);
      if (!text) {
        warnings.push(`"${qid}" was Other with nothing written, so it was left out.`);
        continue;
      }
      record.answers[qid] = "other";
      record.other[qid] = text;
    } else if ((question.answers || []).some((a) => a.id === aid)) {
      record.answers[qid] = aid;
    } else {
      warnings.push(`"${aid}" isn't an answer to "${qid}", so it was left out.`);
    }
  }

  const r = q.rating || { min: 1, max: 5 };
  if (input.rating != null && input.rating !== "") {
    const n = Number(input.rating);
    if (Number.isInteger(n) && n >= r.min && n <= r.max) record.rating = n;
    else warnings.push("The rating wasn't a whole number of stars, so it was left out.");
  }

  record.tip = cleanText(input.tip, max);
  if (!record.tip) delete record.tip;
  if (!Object.keys(record.other).length) delete record.other;

  const ctx = input.context && typeof input.context === "object" ? input.context : {};
  for (const c of q.context || []) {
    if ((c.answers || []).some((a) => a.id === ctx[c.id])) record.context[c.id] = ctx[c.id];
  }

  const cv = str(input.card_version, 30);
  if (cv) record.card_version = cv;
  const at = input.provenance && str(input.provenance.submitted_at, 40);
  record.provenance = at ? { submitted_at: at } : {};

  if (!Object.keys(record.answers).length && record.rating == null && !record.tip) {
    errors.push("There are no answers in it.");
  }
  return { record: errors.length ? null : record, errors, warnings };
}

/**
 * Reads a GitHub issue form submission (### Heading / value sections) into
 * the same shape the card submits. Headings and dropdown values are matched
 * to questions.json by their text, so the form must be generated by
 * build-issue-form.cjs from the same file.
 */
function fromIssueForm(body, q) {
  const sections = {};
  const parts = String(body || "").split(/^###\s+/m).slice(1);
  for (const part of parts) {
    const nl = part.indexOf("\n");
    const heading = (nl < 0 ? part : part.slice(0, nl)).trim();
    const value = (nl < 0 ? "" : part.slice(nl + 1)).trim();
    sections[heading] = value === "_No response_" ? "" : value;
  }
  const byLabel = (answers, label) => {
    const hit = (answers || []).find((a) => a.label === label);
    return hit ? hit.id : null;
  };
  const deviceType = byLabel(q.device_types, sections["Device type"]);
  const input = {
    kind: "device_answers",
    questions_version: q.version,
    manufacturer: sections["Manufacturer"] || "",
    model: sections["Model"] || "",
    firmware: { sw_build_id: sections["Firmware version"] || "" },
    device_type: deviceType || "",
    answers: {},
    other: {},
    context: {},
    provenance: {},
  };
  const useLabel = sections[q.use.text] || "";
  const OTHER = "Other (please say below)";
  if (useLabel === OTHER) input.use = "other";
  else {
    // The form lists every use, prefixed with its device type.
    const all = Object.entries(q.use.answers_by_type).flatMap(([t, list]) => list.map((a) => ({ ...a, label: `${typeLabel(q, t)}: ${a.label}`, type: t })));
    const hit = all.find((a) => a.label === useLabel);
    if (hit) {
      input.use = hit.id;
      if (!input.device_type) input.device_type = hit.type;
    }
  }
  for (const question of q.questions) {
    const v = sections[question.text];
    if (!v || v === "Doesn't apply") continue;
    if (question.allow_other && v === (question.other_label || OTHER)) input.answers[question.id] = "other";
    else {
      const id = byLabel(question.answers, v);
      if (id) input.answers[question.id] = id;
    }
  }
  for (const c of q.context || []) {
    const id = byLabel(c.answers, sections[c.text]);
    if (id) input.context[c.id] = id;
  }
  const rating = (sections[q.rating.text] || "").match(/^(\d)/);
  if (rating) input.rating = Number(rating[1]);
  // One free-text box covers every "Other" choice: it's used for the use if
  // that was Other, otherwise for the first question answered Other.
  const otherText = sections["If you chose an \"other\" answer, tell us more"] || "";
  if (otherText) {
    const target = input.use === "other" ? "use" : Object.keys(input.answers).find((k) => input.answers[k] === "other");
    if (target) input.other[target] = otherText;
  }
  input.tip = sections[q.tip.text] || "";
  return input;
}

function typeLabel(q, id) {
  const t = (q.device_types || []).find((x) => x.id === id);
  return t ? t.label.split(" (")[0] : id;
}

/**
 * Builds data/answers.json from every device file's device_answers:
 * { "<manufacturer_slug>/<model_slug>": { manufacturer, model, total,
 *   by_firmware: { <fw>: { scan_linked, total, by_use: { <use>: {
 *     count, ratings: { "1".."5": n }, rating_average | null,
 *     answers: { <qid>: { <aid>: n } },
 *     context: { <cid>: { <aid>: n } },
 *     tips: [{ text, kind, question? , submitted_at }] } } } } } }
 * scan_linked: a capability scan for the same firmware is in the database,
 * so the answers are tied to a device whose scan anyone can check.
 */
function summarise(devices, q) {
  const out = {};
  const minAvg = (q.rating && q.rating.min_ratings_for_average) || 3;
  for (const { key, file } of devices) {
    const list = Array.isArray(file.device_answers) ? file.device_answers : [];
    if (!list.length) continue;
    const scannedFw = new Set(
      (file.observations || []).map((o) => String(((o && o.identity) || {}).sw_build_id || "")).filter(Boolean)
    );
    const dev = (out[key] = { manufacturer: list[0].manufacturer, model: list[0].model, total: 0, by_firmware: {} });
    for (const r of list) {
      if (!r || r.kind !== "device_answers") continue;
      const fw = firmwareKey(r.firmware);
      const f = (dev.by_firmware[fw] = dev.by_firmware[fw] || {
        scan_linked: scannedFw.has(String((r.firmware || {}).sw_build_id || "")),
        total: 0,
        by_use: {},
      });
      const u = (f.by_use[r.use || "unknown"] = f.by_use[r.use || "unknown"] || {
        count: 0,
        ratings: {},
        rating_average: null,
        answers: {},
        context: {},
        tips: [],
      });
      dev.total++;
      f.total++;
      u.count++;
      if (Number.isInteger(r.rating)) u.ratings[r.rating] = (u.ratings[r.rating] || 0) + 1;
      for (const [qid, aid] of Object.entries(r.answers || {})) {
        u.answers[qid] = u.answers[qid] || {};
        u.answers[qid][aid] = (u.answers[qid][aid] || 0) + 1;
      }
      for (const [cid, aid] of Object.entries(r.context || {})) {
        u.context[cid] = u.context[cid] || {};
        u.context[cid][aid] = (u.context[cid][aid] || 0) + 1;
      }
      const at = (r.provenance && r.provenance.submitted_at) || null;
      for (const [qid, text] of Object.entries(r.other || {})) {
        if (text) u.tips.push({ text, kind: "other", question: qid, submitted_at: at });
      }
      if (r.tip) u.tips.push({ text: r.tip, kind: "tip", submitted_at: at });
    }
    for (const f of Object.values(dev.by_firmware)) {
      for (const u of Object.values(f.by_use)) {
        const n = Object.values(u.ratings).reduce((a, b) => a + b, 0);
        if (n >= minAvg) {
          const sum = Object.entries(u.ratings).reduce((a, [k, v]) => a + Number(k) * v, 0);
          u.rating_average = Math.round((sum / n) * 10) / 10;
        }
        u.tips.sort((a, b) => String(b.submitted_at || "").localeCompare(String(a.submitted_at || "")));
      }
    }
  }
  return Object.fromEntries(Object.keys(out).sort().map((k) => [k, out[k]]));
}

module.exports = { SCHEMA, loadQuestions, cleanText, firmwareKey, questionsFor, useAnswers, validate, fromIssueForm, summarise, typeLabel };
