// -----------------------------------------------------------------------
// Cluster Glossary — curated, plain-English descriptions
// -----------------------------------------------------------------------
// Genuinely standalone, same spirit as capexplorer-constants.js: no
// dependency on anything else, so docs/clusters.js (and, if it's ever
// wanted, the card) can import this directly.
//
// This exists because of a real support case: a device's Zigbee signature
// declaring a cluster as "Input" vs "Output" decides whether it can be
// commanded, or can itself command another device — and that distinction
// isn't obvious unless you already know how Zigbee client/server roles
// work. The device overview (see capexplorer.js's directControlSummary/
// notDirectControlSummary) explains what THIS device's signature means in
// the moment; this glossary is the deeper, click-through reference for
// "what does Input/Output even mean for this specific cluster" — general
// education rather than a claim about any one device.
//
// Each entry:
//   name      — short display name (a fallback; the live page prefers
//               whatever resolved name the community data itself carries,
//               same as everywhere else on the site — see
//               capabilityOutcomePhrase in capexplorer-constants.js)
//   category  — for grouping the glossary page's layout
//   whatItIs  — one or two sentences: what this cluster is actually for,
//               no ZCL jargon
//   asInput   — what it means, in plain language, for a device to declare
//               this cluster as Input (commandable / reporting)
//   asOutput  — what it means for a device to declare this cluster as
//               Output (can itself send this cluster's commands to
//               another device) — or, for clusters where that's not a
//               meaningful real-world scenario (most sensor clusters),
//               an honest note explaining why Output essentially never
//               shows up for this one.
//
// Deliberately covers the clusters actually seen in the live community
// database (see the "not curated" fallback in docs/clusters.js for
// anything not listed here) rather than the full ZCL specification —
// no point describing a cluster nobody has ever submitted a scan for.
export const CLUSTER_GLOSSARY = {
  // ---- Control clusters ----------------------------------------------
  "0x0006": {
    name: "On/Off",
    category: "Control",
    whatItIs:
      "Turns something on or off. The single most common Zigbee cluster — used by simple switches, plugs, relays, and as the base behavior of most lights.",
    asInput:
      "This device's own on/off state can be turned on or off — by Home Assistant, or by another Zigbee device bound directly to it.",
    asOutput:
      "This device can send an on/off command directly to another device over a Zigbee bind — for example, a battery remote or wall switch operating a separate light or relay without a hub in the loop.",
  },
  "0x0008": {
    name: "Level Control",
    category: "Control",
    whatItIs: "Adjusts brightness or position on a sliding scale — dimming a light, or moving something partway.",
    asInput: "This device's own brightness/level can be adjusted — by Home Assistant, or by another device bound directly to it.",
    asOutput:
      "This device can send dimming commands directly to another device over a Zigbee bind — e.g. a dimmer switch or rotary remote adjusting a separate light's brightness without a hub in the loop.",
  },
  "0x0300": {
    name: "Color Control",
    category: "Control",
    whatItIs: "Changes color or color temperature — for lights that support tunable white or full RGB color.",
    asInput: "This device's own color can be changed — by Home Assistant, or by another device bound directly to it.",
    asOutput:
      "This device can send color-change commands directly to another device over a Zigbee bind — a color-picking remote controlling a separate light's color without a hub in the loop.",
  },
  "0x0005": {
    name: "Scenes",
    category: "Control",
    whatItIs: "Stores and recalls preset combinations of settings (a \"scene\") across one or more devices.",
    asInput: "A stored scene can be recalled on this device — by Home Assistant, or by another device bound directly to it.",
    asOutput:
      "This device can trigger a scene recall directly on another device over a Zigbee bind — a wall switch or remote recalling a lighting scene without a hub in the loop.",
  },
  "0x0004": {
    name: "Groups",
    category: "Control",
    whatItIs:
      "Lets a device be added to a Zigbee group, so one command (e.g. \"all lights off\") can address every member at once instead of each device individually.",
    asInput: "This device can be added to, or removed from, Zigbee groups — usually done by Home Assistant or a coordinator during setup.",
    asOutput:
      "Output is unusual for this cluster — group membership is normally managed by a coordinator or hub, not sent device-to-device, so real devices essentially always implement this as Input only.",
  },
  "0x0101": {
    name: "Door Lock",
    category: "Control",
    whatItIs: "Locks and unlocks — smart locks and locking mechanisms.",
    asInput: "This device's lock can be locked or unlocked — by Home Assistant, or by another device bound directly to it.",
    asOutput:
      "This device can send lock/unlock commands directly to another device over a Zigbee bind — a keypad or remote controlling a separate lock without a hub in the loop.",
  },
  "0x0102": {
    name: "Window Covering",
    category: "Control",
    whatItIs: "Opens, closes, or positions covers — blinds, curtains, shades, and garage-door-style covers.",
    asInput: "This device's own position can be controlled — by Home Assistant, or by another device bound directly to it.",
    asOutput:
      "This device can send open/close/position commands directly to another device over a Zigbee bind — a wall switch or remote controlling a separate cover motor without a hub in the loop.",
  },
  "0x0201": {
    name: "Thermostat",
    category: "Control",
    whatItIs: "Controls heating and cooling setpoints and modes.",
    asInput: "This device's heating/cooling setpoint can be controlled — by Home Assistant, or by another device bound directly to it.",
    asOutput:
      "Output is unusual for this cluster — thermostats are almost always the thing being controlled (Input), not a controller of another thermostat, so a genuine Output declaration here is rare.",
  },
  "0x0202": {
    name: "Fan Control",
    category: "Control",
    whatItIs: "Controls fan speed and mode.",
    asInput: "This device's fan speed/mode can be controlled — by Home Assistant, or by another device bound directly to it.",
    asOutput:
      "This device can send fan-speed commands directly to another device over a Zigbee bind — e.g. a wall control operating a separate ceiling fan without a hub in the loop.",
  },
  "0x0200": {
    name: "Pump Control",
    category: "Control",
    whatItIs: "Controls a pump (e.g. for irrigation or circulation), similar in spirit to Fan Control.",
    asInput: "This device's pump can be controlled — by Home Assistant, or by another device bound directly to it.",
    asOutput: "This device can send pump-control commands directly to another device over a Zigbee bind.",
  },

  // ---- Sensing clusters -----------------------------------------------
  "0x0402": {
    name: "Temperature Measurement",
    category: "Sensing",
    whatItIs: "Reports an ambient temperature reading.",
    asInput: "This device reports the temperature it senses — readable by Home Assistant, or by another device bound to it.",
    asOutput:
      "Output is unusual for this cluster — temperature sensors essentially always implement this as Input only (reporting their own reading), not as something bindable to control another device's behavior.",
  },
  "0x0405": {
    name: "Relative Humidity Measurement",
    category: "Sensing",
    whatItIs: "Reports an ambient humidity reading.",
    asInput: "This device reports the humidity it senses — readable by Home Assistant, or by another device bound to it.",
    asOutput: "Output is unusual for this cluster, for the same reason as Temperature Measurement — sensors report, they don't control.",
  },
  "0x0403": {
    name: "Pressure Measurement",
    category: "Sensing",
    whatItIs: "Reports an ambient air pressure reading.",
    asInput: "This device reports the air pressure it senses — readable by Home Assistant, or by another device bound to it.",
    asOutput: "Output is unusual for this cluster, for the same reason as Temperature Measurement.",
  },
  "0x0404": {
    name: "Flow Measurement",
    category: "Sensing",
    whatItIs: "Reports a water or air flow reading.",
    asInput: "This device reports the flow it senses — readable by Home Assistant, or by another device bound to it.",
    asOutput: "Output is unusual for this cluster, for the same reason as Temperature Measurement.",
  },
  "0x0400": {
    name: "Illuminance Measurement",
    category: "Sensing",
    whatItIs: "Reports an ambient light level reading.",
    asInput: "This device reports the light level it senses — readable by Home Assistant, or by another device bound to it.",
    asOutput: "Output is unusual for this cluster, for the same reason as Temperature Measurement.",
  },
  "0x0406": {
    name: "Occupancy Sensing",
    category: "Sensing",
    whatItIs: "Reports whether motion or occupancy is currently detected.",
    asInput: "This device reports the motion/occupancy it detects — readable by Home Assistant, or by another device bound to it.",
    asOutput:
      "Output is unusual for this cluster — a motion sensor almost always just reports its own detection (Input); it doesn't typically send commands to control something else directly over this cluster (Home Assistant automations, not direct binding, are the normal way \"motion turns on a light\" is built).",
  },
  "0x0500": {
    name: "IAS Zone",
    category: "Sensing",
    whatItIs: "Reports security/alarm state — contact sensors, motion sensors used for security, water leak sensors, and similar.",
    asInput: "This device reports the alarm/contact state it detects — readable by Home Assistant, or by another device bound to it.",
    asOutput: "Output is unusual for this cluster — these are almost always sensors reporting their own state, not controllers of other devices.",
  },
  "0x0501": {
    name: "IAS ACE",
    category: "Sensing",
    whatItIs: "Alarm Control & Emergency — used by security system control panels/keypads to arm/disarm a zone of IAS Zone devices.",
    asInput: "This device can be armed/disarmed as part of a security zone — by Home Assistant, or by another device bound to it.",
    asOutput: "This device can send arm/disarm commands directly to a security panel or zone controller over a Zigbee bind.",
  },
  "0x0502": {
    name: "IAS WD (Warning Device)",
    category: "Sensing",
    whatItIs: "Controls a siren or other warning device — sound, strobe, or both.",
    asInput: "This device's siren/strobe can be triggered — by Home Assistant, or by another device bound to it.",
    asOutput: "This device can trigger a siren/strobe directly on another device over a Zigbee bind.",
  },
  "0x0b04": {
    name: "Electrical Measurement",
    category: "Sensing",
    whatItIs: "Reports live electrical readings — voltage, current, and/or power draw.",
    asInput: "This device reports the power draw it measures — readable by Home Assistant, or by another device bound to it.",
    asOutput: "Output is unusual for this cluster, for the same reason as Temperature Measurement.",
  },
  "0x0702": {
    name: "Metering",
    category: "Sensing",
    whatItIs: "Reports cumulative energy usage (kWh), the kind of reading a utility meter tracks.",
    asInput: "This device reports the energy use it measures — readable by Home Assistant, or by another device bound to it.",
    asOutput: "Output is unusual for this cluster, for the same reason as Temperature Measurement.",
  },
  "0x0b01": {
    name: "Meter Identification",
    category: "Sensing",
    whatItIs: "Identifying metadata for a metering device (utility, unit of measure, etc.) — a companion to the Metering cluster, not a reading itself.",
    asInput: "This device reports its own meter identification details.",
    asOutput: "Output is unusual for this cluster.",
  },
  "0x0b05": {
    name: "Diagnostics",
    category: "Sensing",
    whatItIs: "Reports network/radio health details for the device itself — packet counts, last message LQI, and similar.",
    asInput: "This device reports its own diagnostic counters — readable by Home Assistant.",
    asOutput: "Output is unusual for this cluster — it exists purely for a device to report on itself.",
  },
  "0x0002": {
    name: "Device Temperature Configuration",
    category: "Sensing",
    whatItIs: "Reports the device's own internal temperature (its electronics, not the room) — a health/safety reading, not a room sensor.",
    asInput: "This device reports its own internal temperature — readable by Home Assistant.",
    asOutput: "Output is unusual for this cluster.",
  },

  // ---- Infrastructure / device-management clusters --------------------
  "0x0000": {
    name: "Basic",
    category: "Infrastructure",
    whatItIs: "Basic device information (manufacturer, model, power source) and a few universal commands like \"reset to factory defaults.\" Present on almost every Zigbee device.",
    asInput: "Home Assistant, or another bound device, can read this device's basic info or send it a reset command.",
    asOutput: "Output is unusual for this cluster — it's informational/administrative, not something one device uses to control another.",
  },
  "0x0001": {
    name: "Power Configuration",
    category: "Infrastructure",
    whatItIs: "Reports battery level and voltage, for battery-powered devices.",
    asInput: "This device reports its own battery level — readable by Home Assistant.",
    asOutput: "Output is unusual for this cluster — it exists purely for a device to report on itself.",
  },
  "0x0003": {
    name: "Identify",
    category: "Infrastructure",
    whatItIs: "Makes a device visibly/audibly identify itself (e.g. a light blinks) — mainly a setup/debugging aid, present on almost every Zigbee device.",
    asInput: "This device can be told to identify itself — by Home Assistant, or by another device bound to it.",
    asOutput: "This device can send an identify command directly to another device over a Zigbee bind.",
  },
  "0x0007": {
    name: "On/Off Switch Configuration",
    category: "Infrastructure",
    whatItIs: "Configuration metadata for a physical switch input (e.g. whether it behaves as a toggle or a momentary button) — not the on/off command itself, which lives on the On/Off cluster.",
    asInput: "This device's switch-behavior settings can be read or configured — by Home Assistant, or by another device bound to it.",
    asOutput: "Output is unusual for this cluster.",
  },
  "0x0009": {
    name: "Alarms",
    category: "Infrastructure",
    whatItIs: "A generic alarm-reporting mechanism used internally by several other clusters (distinct from the security-focused IAS Zone cluster).",
    asInput: "This device reports alarm conditions it detects.",
    asOutput: "Output is unusual for this cluster.",
  },
  "0x000a": {
    name: "Time",
    category: "Infrastructure",
    whatItIs: "Lets a device read or be given the current time — used by devices with schedules or that timestamp their own data.",
    asInput: "This device's clock can be read or set — by Home Assistant, or by another device bound to it.",
    asOutput: "This device can send its own time to another device over a Zigbee bind — uncommon in practice; most devices get time from Home Assistant/the coordinator instead.",
  },
  "0x0019": {
    name: "OTA",
    category: "Infrastructure",
    whatItIs: "Over-the-air firmware update delivery. Almost every Zigbee device declares this as Output — it's how firmware updates reach the device, not a control mechanism, and does not mean the device can control anything else.",
    asInput: "Rare — a device acting as the source of firmware updates for others (e.g. some hub-like devices).",
    asOutput: "This device can request/receive firmware updates. This is the single most common reason a device shows an Output cluster with nothing else notable about it — it is not evidence the device can control anything.",
  },
  "0x0020": {
    name: "Poll Control",
    category: "Infrastructure",
    whatItIs: "Lets a battery-powered end device negotiate how often it \"wakes up\" to check for messages — a power-saving mechanism, not a user-facing feature.",
    asInput: "Home Assistant, or the coordinator, can adjust this device's polling interval.",
    asOutput: "Output is unusual for this cluster.",
  },
  "0x0021": {
    name: "Green Power",
    category: "Infrastructure",
    whatItIs: "Supports Green Power — a low-power Zigbee variant used by some battery-free/energy-harvesting switches. A device declaring this is usually acting as a Green Power proxy, not itself a Green Power switch.",
    asInput: "Rare in practice.",
    asOutput: "This device can relay Green Power traffic on behalf of energy-harvesting devices nearby — an infrastructure role, not evidence it can control a specific other device.",
  },
  "0x1000": {
    name: "Touchlink Commissioning",
    category: "Infrastructure",
    whatItIs: "Supports Touchlink, a proximity-based pairing mechanism (point a remote at a light to pair it) separate from normal network joining.",
    asInput: "This device can be commissioned via Touchlink by a nearby controller.",
    asOutput: "This device can commission other Touchlink-capable devices by proximity — a pairing mechanism, not day-to-day control.",
  },
  "0xfc57": {
    name: "Works with all Hubs (WWAH)",
    category: "Infrastructure",
    whatItIs: "A semi-standardized cluster used to signal hub-compatibility behavior (seen consistently across multiple vendors, notably when connecting to Amazon Alexa/Echo) — configuration, not a user-facing control.",
    asInput: "Home Assistant, or the coordinator, can read/configure this device's hub-compatibility settings.",
    asOutput: "Output is unusual for this cluster.",
  },
  "0xfc11": {
    name: "Device settings (Sonoff)",
    category: "Infrastructure",
    whatItIs: "Sonoff-specific device settings (external trigger mode, detach relay, turbo mode, network LED) — manufacturer-private configuration, not a standard ZCL cluster.",
    asInput: "This device's Sonoff-specific settings can be read/configured — by Home Assistant.",
    asOutput: "Output is unusual for this cluster.",
  },

  // ---- Manufacturer-specific fallback ----------------------------------
  "0xffff": {
    name: "Manufacturer Specific",
    category: "Manufacturer-specific",
    whatItIs: "A generic placeholder some devices use for vendor-private functionality that hasn't been identified with a real name yet.",
    asInput: "Unknown without further investigation — see the site's Unidentified Capabilities section.",
    asOutput: "Unknown without further investigation.",
  },
};

// Everything below this line is real, common Zigbee behavior worth a
// general note even when the specific cluster hasn't been curated above —
// shown by docs/clusters.js under any cluster without its own entry.
export const UNCURATED_CLUSTER_NOTE =
  "This specific cluster hasn't been individually described here yet — usually because it's a manufacturer-private " +
  "cluster (Zigbee's 0xFC00–0xFFFF range, where the same numeric ID can mean different things for different " +
  "vendors) or one this database has only seen once or twice. The same general rule still applies: " +
  "Input means this device can be commanded with it (or can report data over it); Output means this device can " +
  "itself send that cluster's commands directly to another device, without a hub. See the general definitions above.";
