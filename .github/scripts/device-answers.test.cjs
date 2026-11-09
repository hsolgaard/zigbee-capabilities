// node --test .github/scripts/
"use strict";
const test = require("node:test");
const assert = require("node:assert");
const path = require("path");
const fs = require("fs");
const da = require("./device-answers.cjs");

const root = path.join(__dirname, "..", "..");
const q = da.loadQuestions(root);

const base = {
  kind: "device_answers",
  manufacturer: "Repenic Ltd.",
  model: "RS-R03AZG",
  firmware: { sw_build_id: "1.0.5", registry_sw_version: "0x00000017" },
  device_type: "wall_switch",
  use: "remote_only",
  answers: { needed_setting: "other", presses_arrive: "sometimes_missed", power_on: "last_state", nonsense: "x" },
  other: { needed_setting: "Write attr 0 on cluster 0xE00B = 1 (remote mode). Mine is 54:f2:83:ff:fe:8a:ae:53, see https://example.com" },
  rating: 2,
  tip: "Group bindings only. Contact me at a@b.co",
  context: { system: "zha", coordinator: "silabs", owned_for: "lt_month" },
};

test("question ids are unique and every question has answers", () => {
  const ids = q.questions.map((x) => x.id);
  assert.strictEqual(new Set(ids).size, ids.length);
  for (const x of q.questions) {
    assert.ok(x.answers.length >= 2, x.id);
    assert.strictEqual(new Set(x.answers.map((a) => a.id)).size, x.answers.length, x.id);
    for (const t of x.types) assert.ok(q.device_types.some((d) => d.id === t), `${x.id}: ${t}`);
    for (const u of x.uses || []) assert.ok(Object.values(q.use.answers_by_type).flat().some((a) => a.id === u), `${x.id}: ${u}`);
  }
  for (const t of q.device_types) assert.ok(q.use.answers_by_type[t.id], t.id);
});

test("cleans free text and keeps cluster ids", () => {
  const s = da.cleanText("Set 0xE00B attr 0. ieee 54:f2:83:ff:fe:8a:ae:53 ip 10.35.1.76 me@x.org http://x.y/z");
  assert.ok(s.includes("0xE00B"));
  assert.ok(!/54:f2|10\.35|me@x|http/.test(s));
  assert.strictEqual(da.cleanText("a".repeat(400)).length, 280);
});

test("validates, drops what doesn't apply and cleans text", () => {
  const { record, errors, warnings } = da.validate(base, q);
  assert.deepStrictEqual(errors, []);
  assert.strictEqual(record.answers.needed_setting, "other");
  assert.ok(record.other.needed_setting.includes("0xE00B") && !record.other.needed_setting.includes("54:f2"));
  assert.ok(!("power_on" in record.answers), "power cut question doesn't apply to a switch used only as a remote");
  assert.ok(!("nonsense" in record.answers));
  assert.ok(warnings.length >= 2);
  assert.strictEqual(record.rating, 2);
  assert.ok(record.tip.includes("[e-mail]"));
  assert.deepStrictEqual(record.context, base.context);
});

test("refuses missing firmware, bad use and empty Other", () => {
  assert.ok(da.validate({ ...base, firmware: {} }, q).errors.some((e) => e.includes("firmware")));
  assert.ok(da.validate({ ...base, use: "main_light" }, q).errors.length);
  assert.ok(da.validate({ ...base, use: "other", other: {} }, q).errors.length);
  const ok = da.validate({ ...base, use: "other", other: { use: "Doorbell" } }, q);
  assert.deepStrictEqual(ok.errors, []);
  assert.strictEqual(ok.record.other.use, "Doorbell");
});

test("reads the generated issue form", () => {
  const typeLabel = q.device_types.find((t) => t.id === "light").label;
  const use = q.use.answers_by_type.light.find((a) => a.id === "lamp").label;
  const power = q.questions.find((x) => x.id === "power_on");
  const pairing = q.questions.find((x) => x.id === "pairing");
  const body = [
    "### Manufacturer\n\nIKEA of Sweden",
    "### Model\n\nTRADFRI bulb E27 WW 806lm",
    "### Firmware version\n\n1.0.012",
    `### Device type\n\n${typeLabel}`,
    `### ${q.use.text}\n\nLight, bulb or LED driver: ${use}`,
    `### ${power.text}\n\n${power.answers[3].label}`,
    `### ${pairing.text}\n\n${pairing.other_label}`,
    `### ${q.questions.find((x) => x.id === "ota").text}\n\nDoesn't apply`,
    '### If you chose an "other" answer, tell us more\n\nSix on-off cycles, 1 s apart.',
    `### ${q.rating.text}\n\n4 – Good`,
    `### ${q.context[0].text}\n\nZigbee2MQTT`,
    `### ${q.tip.text}\n\n_No response_`,
  ].join("\n\n");
  const input = da.fromIssueForm(body, q);
  const { record, errors } = da.validate(input, q);
  assert.deepStrictEqual(errors, []);
  assert.strictEqual(record.device_type, "light");
  assert.strictEqual(record.use, "lamp");
  assert.strictEqual(record.answers.power_on, "ignores_setting");
  assert.strictEqual(record.answers.pairing, "other");
  assert.strictEqual(record.other.pairing, "Six on-off cycles, 1 s apart.");
  assert.ok(!("ota" in record.answers));
  assert.strictEqual(record.rating, 4);
  assert.strictEqual(record.context.system, "z2m");
  assert.ok(!record.tip);
});

test("a switch module behind a normal switch gets its own questions, not button ones", () => {
  const typeLabel = q.device_types.find((t) => t.id === "switch_module").label;
  const use = q.use.answers_by_type.switch_module.find((a) => a.id === "wired_own_load").label;
  const qt = (id) => q.questions.find((x) => x.id === id);
  const body = [
    "### Manufacturer\n\nSONOFF",
    "### Model\n\nZBMINIL2",
    "### Firmware version\n\n0x0000100e",
    `### Device type\n\n${typeLabel}`,
    `### ${q.use.text}\n\n${typeLabel.split(" (")[0]}: ${use}`,
    `### ${qt("input_detached").text}\n\nNot sure`,
    `### ${qt("decoupled").text}\n\nNo`,
    `### ${qt("router_quality").text}\n\n${qt("router_quality").answers.find((a) => a.id === "not_a_router").label}`,
    `### ${qt("responds_to_bindings").text}\n\nEvery time`,
    `### ${qt("hold_to_dim").text}\n\nYes`,
  ].join("\n\n");
  const { record, errors } = da.validate(da.fromIssueForm(body, q), q);
  assert.deepStrictEqual(errors, []);
  assert.strictEqual(record.device_type, "switch_module");
  assert.strictEqual(record.use, "wired_own_load");
  assert.strictEqual(record.answers.input_detached, "not_sure");
  assert.strictEqual(record.answers.router_quality, "not_a_router");
  assert.strictEqual(record.answers.responds_to_bindings, "always");
  assert.ok(!("decoupled" in record.answers), "the button question is only for wall switches");
  assert.ok(!("hold_to_dim" in record.answers));
});

test("issue form file is in step with questions.json", () => {
  const form = fs.readFileSync(path.join(root, ".github", "ISSUE_TEMPLATE", "device-answers.yml"), "utf8");
  for (const x of q.questions) assert.ok(form.includes(JSON.stringify(x.text)), x.id);
});

test("summarises per firmware and use, links scans, averages only from 3 ratings", () => {
  const rec = (fw, use, rating, extra = {}) => ({ ...da.validate({ ...base, firmware: { sw_build_id: fw }, use, rating, ...extra }, q).record, provenance: { submitted_at: `2026-11-0${rating}` } });
  const file = {
    observations: [{ identity: { sw_build_id: "1.0.5" } }],
    device_answers: [rec("1.0.5", "remote_only", 2), rec("1.0.5", "remote_only", 3), rec("1.0.5", "wired_own_load", 5), rec("1.0.6", "remote_only", 4)],
  };
  const out = da.summarise([{ key: "repenic-ltd/rs-r03azg", file }], q);
  const dev = out["repenic-ltd/rs-r03azg"];
  assert.strictEqual(dev.total, 4);
  assert.strictEqual(dev.by_firmware["1.0.5"].scan_linked, true);
  assert.strictEqual(dev.by_firmware["1.0.6"].scan_linked, false);
  const remote = dev.by_firmware["1.0.5"].by_use.remote_only;
  assert.strictEqual(remote.count, 2);
  assert.strictEqual(remote.rating_average, null, "only 2 ratings");
  assert.deepStrictEqual(remote.answers.presses_arrive, { sometimes_missed: 2 });
  assert.strictEqual(remote.tips.filter((t) => t.kind === "tip").length, 2);
  const three = da.summarise([{ key: "k", file: { device_answers: [rec("1", "remote_only", 1), rec("1", "remote_only", 2), rec("1", "remote_only", 4)] } }], q);
  assert.strictEqual(three.k.by_firmware["1"].by_use.remote_only.rating_average, 2.3);
});
