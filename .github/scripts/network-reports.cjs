// Network reports (ZHA Bindings Manager 1.10.0+): anonymised evidence about
// short (network) address changes and missed remote presses on one network,
// to find out whether address changes explain bindings that stop working
// although they're still in the remote's table. Submitted only after the
// user reviews it. Used by ingest-submission.yml (check + clean) and
// rebuild-capability-index.yml (data/network-reports.json summary).
//
// Record: { kind: "network_report", schema: 1, card_version,
//   period: { days }, system, coordinator: { manufacturer, model, firmware },
//   network: { devices, routers, end_devices },
//   devices: [{ id: "d1", manufacturer, model, firmware, power, role,
//               address_changes, changes: [{ after_hours, seen }] }],
//   pairs: [{ remote, light, presses, followed, missed }],
//   misses: [{ remote, light, hours_since_last_ok, address_changed_since_last_ok, binding_in_last_read }] }
// No IEEE or network addresses, names, areas or times of day.
"use strict";

const str = (v, n = 80) => (typeof v === "string" ? v.trim().slice(0, n) : "");
const int = (v, max = 1e6) => (Number.isInteger(v) && v >= 0 && v <= max ? v : null);
const num = (v) => (typeof v === "number" && isFinite(v) && v >= 0 && v < 1e6 ? Math.round(v * 10) / 10 : null);
const ID = /^d\d{1,4}$/;
const ROLES = ["coordinator", "router", "end_device", "unknown"];
const SEEN = ["joined", "snapshot"];

function validate(input) {
  const errors = [];
  if (!input || typeof input !== "object" || input.kind !== "network_report") {
    return { record: null, errors: ["Not a network report."] };
  }
  const c = input.coordinator || {};
  const net = input.network || {};
  const record = {
    kind: "network_report",
    schema: 1,
    card_version: str(input.card_version, 30),
    period: { days: num((input.period || {}).days) },
    system: str(input.system, 20) || "zha",
    coordinator: { manufacturer: str(c.manufacturer), model: str(c.model), firmware: str(c.firmware, 60) },
    network: { devices: int(net.devices, 5000), routers: int(net.routers, 5000), end_devices: int(net.end_devices, 5000) },
    devices: [],
    pairs: [],
    misses: [],
  };
  const ids = new Set();
  for (const d of (Array.isArray(input.devices) ? input.devices : []).slice(0, 2000)) {
    if (!d || !ID.test(d.id) || ids.has(d.id)) continue;
    ids.add(d.id);
    record.devices.push({
      id: d.id,
      manufacturer: str(d.manufacturer),
      model: str(d.model),
      firmware: str(d.firmware, 60),
      power: str(d.power, 20),
      role: ROLES.includes(d.role) ? d.role : "unknown",
      address_changes: int(d.address_changes, 10000) || 0,
      changes: (Array.isArray(d.changes) ? d.changes : [])
        .slice(0, 50)
        .map((x) => ({ after_hours: num(x && x.after_hours), seen: SEEN.includes(x && x.seen) ? x.seen : "snapshot" }))
        .filter((x) => x.after_hours != null),
    });
  }
  const known = (id) => typeof id === "string" && ids.has(id);
  for (const p of (Array.isArray(input.pairs) ? input.pairs : []).slice(0, 2000)) {
    if (!p || !known(p.remote) || !known(p.light)) continue;
    record.pairs.push({ remote: p.remote, light: p.light, presses: int(p.presses) || 0, followed: int(p.followed) || 0, missed: int(p.missed) || 0 });
  }
  for (const m of (Array.isArray(input.misses) ? input.misses : []).slice(0, 500)) {
    if (!m || !known(m.remote) || !known(m.light)) continue;
    record.misses.push({
      remote: m.remote,
      light: m.light,
      hours_since_last_ok: num(m.hours_since_last_ok),
      address_changed_since_last_ok: m.address_changed_since_last_ok === true,
      binding_in_last_read: m.binding_in_last_read === true,
    });
  }
  if (!record.devices.length) errors.push("The report has no devices.");
  if (!record.coordinator.model && !record.coordinator.manufacturer) errors.push("The coordinator is missing.");
  return { record: errors.length ? null : record, errors };
}

/**
 * data/network-reports.json: across all reports,
 *  { reports, by_coordinator: { "<manufacturer> <model>|<firmware>": { reports, devices, address_changes } },
 *    by_model: { "<manufacturer>|<model>": { devices, devices_with_changes, address_changes,
 *                by_firmware: { fw: { devices, devices_with_changes, address_changes } } } },
 *    misses: { total, address_changed_before: n, binding_in_table: n },
 *    remotes: { "<manufacturer>|<model>": { presses, missed, missed_after_address_change } } }
 */
function summarise(reports) {
  const out = { reports: 0, by_coordinator: {}, by_model: {}, misses: { total: 0, address_changed_before: 0, binding_in_table: 0 }, remotes: {} };
  for (const r of reports || []) {
    if (!r || r.kind !== "network_report") continue;
    out.reports++;
    const ck = `${r.coordinator.manufacturer} ${r.coordinator.model}`.trim() + `|${r.coordinator.firmware || "unknown"}`;
    const c = (out.by_coordinator[ck] = out.by_coordinator[ck] || { reports: 0, devices: 0, address_changes: 0 });
    c.reports++;
    const byId = new Map(r.devices.map((d) => [d.id, d]));
    for (const d of r.devices) {
      if (d.role === "coordinator") continue;
      c.devices++;
      c.address_changes += d.address_changes;
      const mk = `${d.manufacturer}|${d.model}`;
      const m = (out.by_model[mk] = out.by_model[mk] || { devices: 0, devices_with_changes: 0, address_changes: 0, by_firmware: {} });
      const f = (m.by_firmware[d.firmware || "unknown"] = m.by_firmware[d.firmware || "unknown"] || { devices: 0, devices_with_changes: 0, address_changes: 0 });
      for (const t of [m, f]) {
        t.devices++;
        t.address_changes += d.address_changes;
        if (d.address_changes) t.devices_with_changes++;
      }
    }
    for (const p of r.pairs) {
      const rem = byId.get(p.remote);
      if (!rem) continue;
      const rk = `${rem.manufacturer}|${rem.model}`;
      const t = (out.remotes[rk] = out.remotes[rk] || { presses: 0, missed: 0, missed_after_address_change: 0 });
      t.presses += p.presses;
      t.missed += p.missed;
    }
    for (const x of r.misses) {
      out.misses.total++;
      if (x.address_changed_since_last_ok) out.misses.address_changed_before++;
      if (x.binding_in_last_read) out.misses.binding_in_table++;
      const rem = byId.get(x.remote);
      if (rem && x.address_changed_since_last_ok) {
        const rk = `${rem.manufacturer}|${rem.model}`;
        (out.remotes[rk] = out.remotes[rk] || { presses: 0, missed: 0, missed_after_address_change: 0 }).missed_after_address_change++;
      }
    }
  }
  const sortObj = (o) => Object.fromEntries(Object.keys(o).sort().map((k) => [k, o[k]]));
  out.by_coordinator = sortObj(out.by_coordinator);
  out.by_model = sortObj(out.by_model);
  out.remotes = sortObj(out.remotes);
  return out;
}

module.exports = { validate, summarise };
