// Builds data/z2m-models.json: which Zigbee2MQTT product code each device
// model belongs to, taken from Zigbee2MQTT's own device definitions
// (zigbee-herdsman-converters, MIT licence). Nothing here is maintained by
// hand; the weekly workflow regenerates it from the latest release.
//
// Why: devices report a Zigbee model string (what ZHA shows, e.g.
// "CH2AX/SWITCH/1" or "RODRET wireless dimmer"), but zigbee2mqtt.io names
// its device photos by product code ("41E2PBSWMZ/356PB2MBTZ", "E2201").
// Only about a third of models match their product code. ZHA Bindings
// Manager uses this file to find the right photo.
//
// Output:
//   { source, source_version, models: {"<zigbee model>": "<product code>"},
//     fingerprints: {"<manufacturer>|<zigbee model>": "<product code>"} }
// fingerprints covers Tuya-style devices, where one model string (TS011F,
// TS0601...) is shared by many products and only manufacturer + model
// identifies the product.
const fs = require("fs");
const path = require("path");

const pkgDir = path.dirname(require.resolve("zigbee-herdsman-converters/package.json"));
const version = require(path.join(pkgDir, "package.json")).version;
const dir = path.join(pkgDir, "dist", "devices");

const models = {};
const fingerprints = {};
let definitions = 0;
for (const file of fs.readdirSync(dir).filter((f) => f.endsWith(".js")).sort()) {
  let mod;
  try {
    mod = require(path.join(dir, file));
  } catch (e) {
    console.warn(`Skipping ${file}: ${e.message}`);
    continue;
  }
  for (const d of mod.definitions || []) {
    if (!d || !d.model) continue;
    definitions++;
    for (const z of d.zigbeeModel || []) {
      if (typeof z === "string" && !(z in models)) models[z] = d.model;
    }
    for (const f of d.fingerprint || []) {
      if (f && typeof f.modelID === "string" && typeof f.manufacturerName === "string") {
        const key = `${f.manufacturerName}|${f.modelID}`;
        if (!(key in fingerprints)) fingerprints[key] = d.model;
      }
    }
    // White-label products with their own fingerprint get their own code.
    for (const w of d.whiteLabel || []) {
      for (const f of w.fingerprint || []) {
        if (f && typeof f.modelID === "string" && typeof f.manufacturerName === "string") {
          fingerprints[`${f.manufacturerName}|${f.modelID}`] = w.model;
        }
      }
    }
  }
}

const sortKeys = (o) => Object.fromEntries(Object.keys(o).sort().map((k) => [k, o[k]]));
const doc = {
  source: "zigbee-herdsman-converters (Zigbee2MQTT device definitions, MIT licence)",
  source_version: version,
  models: sortKeys(models),
  fingerprints: sortKeys(fingerprints),
};
const out = process.argv[2] || "data/z2m-models.json";
fs.writeFileSync(out, JSON.stringify(doc, null, 0) + "\n");
console.log(
  `${definitions} definitions from zigbee-herdsman-converters ${version}: ` +
    `${Object.keys(models).length} models, ${Object.keys(fingerprints).length} fingerprints -> ${out}`
);
