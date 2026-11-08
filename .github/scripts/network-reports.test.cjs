// node --test .github/scripts/network-reports.test.cjs
"use strict";
const test = require("node:test");
const assert = require("node:assert");
const { validate, summarise } = require("./network-reports.cjs");

const report = {
  kind: "network_report",
  card_version: "1.10.0",
  period: { days: 6.5 },
  coordinator: { manufacturer: "SONOFF", model: "Dongle-M", firmware: "8.0.2" },
  network: { devices: 3, routers: 1, end_devices: 1 },
  devices: [
    { id: "d1", manufacturer: "SONOFF", model: "Dongle-M", firmware: "8.0.2", power: "Mains", role: "coordinator", address_changes: 0 },
    { id: "d2", manufacturer: "IKEA of Sweden", model: "TRADFRI bulb", firmware: "1.0.012", power: "Mains", role: "router", address_changes: 1, changes: [{ after_hours: 30.25, seen: "joined" }], ieee: "aa:bb" },
    { id: "d3", manufacturer: "IKEA of Sweden", model: "TRADFRI on/off switch", firmware: "2.2.010", power: "Battery", role: "end_device", address_changes: 0 },
    { id: "x9", model: "dropped: bad id" },
  ],
  pairs: [{ remote: "d3", light: "d2", presses: 10, followed: 8, missed: 2 }],
  misses: [{ remote: "d3", light: "d2", hours_since_last_ok: 5, address_changed_since_last_ok: true, binding_in_last_read: true }, { remote: "d3", light: "zz" }],
};

test("keeps only anonymous fields and known ids", () => {
  const { record, errors } = validate(report);
  assert.deepStrictEqual(errors, []);
  assert.strictEqual(record.devices.length, 3);
  assert.ok(!("ieee" in record.devices[1]));
  assert.strictEqual(record.devices[1].changes[0].after_hours, 30.3);
  assert.strictEqual(record.misses.length, 1);
  assert.ok(validate({ kind: "network_report", devices: [], coordinator: {} }).errors.length);
});

test("summarises by model, coordinator and remote", () => {
  const { record } = validate(report);
  const s = summarise([record, record]);
  assert.strictEqual(s.reports, 2);
  assert.deepStrictEqual(s.by_coordinator["SONOFF Dongle-M|8.0.2"], { reports: 2, devices: 4, address_changes: 2 });
  assert.strictEqual(s.by_model["IKEA of Sweden|TRADFRI bulb"].devices_with_changes, 2);
  assert.deepStrictEqual(s.remotes["IKEA of Sweden|TRADFRI on/off switch"], { presses: 20, missed: 4, missed_after_address_change: 2 });
  assert.deepStrictEqual(s.misses, { total: 2, address_changed_before: 2, binding_in_table: 2 });
});
