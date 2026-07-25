// -----------------------------------------------------------------------
// Capability Explorer constants — genuinely standalone
// -----------------------------------------------------------------------
// No dependency on constants.js or anything else card-specific
// (CLUSTER_INFO, CLUSTER_COMMANDS, binding defaults, etc.) — this file plus
// capexplorer.js are the complete pure data layer behind the Zigbee
// Capability Explorer, and both are meant to be lifted wholesale into
// something that isn't this card (see docs/, the standalone zigbee-
// capabilities website, which imports these two files directly and nothing
// else from src/). constants.js re-exports CAPABILITY_DB_REPO from here so
// card.js's existing imports keep working unchanged.

// The community-maintained, openly-licensed device capability database
// this card can submit "Check supported commands" scans to (see that
// repo's own README for the schema and review process). One constant so
// the target repo only needs updating in one place if it's ever
// renamed/moved — which already happened once (zha-device-capabilities ->
// zigbee-capabilities).
export const CAPABILITY_DB_REPO = "hsolgaard/zigbee-capabilities";

// Plain-English "what this cluster lets a device do" labels for the
// Capability Explorer's "Supports" grouping (see capexplorer.js's
// groupCapabilitiesByOutcome). Spans control, sensor, and security
// clusters, since the Capability Explorer's job is describing a device's
// *entire* capability set, not just what a binding controls — "X control"
// would read wrong for a sensor ("occupancy control" isn't a thing;
// "occupancy sensing" is). Anything not listed here falls back to the
// cluster's own recorded name (every real submission carries one), or as
// a last resort a formatted hex ID — never a guess at a phrase.
export const CAPABILITY_OUTCOME_PHRASE = {
  0x0005: "Scene control",
  0x0006: "On/off control",
  0x0007: "On/off switch configuration",
  0x0008: "Brightness control",
  0x0101: "Lock control",
  0x0102: "Open/close control",
  0x0200: "Pump control",
  0x0201: "Thermostat control",
  0x0202: "Fan speed control",
  0x0203: "Dehumidification control",
  0x0300: "Color control",
  0x0301: "Ballast control",
  0x0400: "Illuminance sensing",
  0x0401: "Illuminance level sensing",
  0x0402: "Temperature sensing",
  0x0403: "Pressure sensing",
  0x0404: "Flow sensing",
  0x0405: "Humidity sensing",
  0x0406: "Occupancy sensing",
  0x0500: "Motion/intrusion alarm",
  0x0501: "Alarm control (ACE)",
  0x0502: "Siren/warning device",
  0x0702: "Energy metering",
  0x0b01: "Meter identification",
  0x0b04: "Electrical measurement",
};
export function capabilityOutcomePhrase(id, fallbackName) {
  const n = Number(id);
  return (
    CAPABILITY_OUTCOME_PHRASE[n] || fallbackName || `Cluster 0x${n.toString(16).padStart(4, "0")}`
  );
}
