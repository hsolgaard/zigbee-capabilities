# ZHA Device Capabilities

[Zigbee Capabilities website](https://hsolgaard.github.io/zigbee-capabilities/)

A community-contributed, openly-licensed dataset of confirmed Zigbee device
capabilities — which clusters, commands, and attributes a specific
device/firmware combination actually supports, gathered from real live
device scans rather than manufacturer documentation (which is often
incomplete, wrong, or nonexistent for these devices).

This repo is not tied to any one tool. It exists so that anyone working
with Zigbee devices — Home Assistant/ZHA users, zigbee2mqtt users, quirk
authors, other Lovelace cards, or anything else — can look up what a device
is actually capable of instead of re-discovering it themselves.

It's maintained alongside [zha-bindings-manager](https://github.com/hsolgaard/zha-bindings-manager),
the Lovelace card that originated it, but the data itself is independent
and free to use in any project.

## What's in a record

Each record describes one manufacturer/model (optionally split further by
firmware, since capability can change between firmware versions):

- **Identity** — manufacturer, model, and hardware-level identifiers
  (`sw_build_id`/`app_version`, `hw_version`, `date_code`) where available,
  since the same model name is sometimes sold across genuinely different
  hardware revisions.
- **Per-endpoint signature** — profile ID, device type, and the input/output
  cluster list for each endpoint.
- **Per-cluster command support** — which commands a cluster confirms it
  accepts (`commands_received`) and, where discoverable, generates
  (`commands_generated`).
- **Per-cluster attribute support** — which attributes a cluster confirms it
  exposes.
- **Provenance** — submission date, and the scanning tool/library versions
  used (e.g. zha_toolkit version, zigpy version if known), so a record can
  be judged against known fixes rather than treated as timeless truth.

## What's deliberately excluded

No IEEE address, no entity IDs, no area/room names, no network topology or
binding data, and nothing else that identifies a specific installation or
person. This dataset describes what a device *model* can do — never
anything about a specific device owner's network. Submissions containing
anything beyond device-capability data will be rejected.

## Structure

```
data/{manufacturer}/{model}.json
schema/capability-record.schema.json   (coming soon)
```

One JSON file per manufacturer + model, lowercase, hyphenated, with unsafe
filename characters stripped. Example:

```
SONOFF ZBMINIR2        ->  data/sonoff/zbminir2.json
IKEA of Sweden Vallhorn ->  data/ikea-of-sweden/vallhorn.json
```

Each file holds two sections:

```json
{
  "observations": [ /* every individual scan submitted, kept as-is, never overwritten */ ],
  "capabilities": { /* computed summary, grouped by endpoint + firmware */ }
}
```

`observations` is the raw evidence log — every submission for this
manufacturer/model lands here, including repeat scans and different
firmware versions, so nothing is ever silently discarded or overwritten.
`capabilities` is a computed summary derived entirely from `observations`,
grouped by endpoint and firmware build, showing which commands each
endpoint confirms it supports. If two observations for the same
endpoint+firmware genuinely disagree on whether a command is present, it's
marked `conflicting` rather than one answer silently winning — that's a
signal worth a second look, not a bug. This is what makes the dataset both
a complete history and something you can query directly for "what does
this device support."

## Contributing

**Automatically:** if you're using a tool that supports it (e.g.
zha-bindings-manager's "Share this scan" feature), it will generate a
pre-filled GitHub issue with your scan data for you to review and submit.

**Manually:** open a new issue labeled `device-submission` with your
manufacturer, model, firmware version, and the cluster/command/attribute
data you've confirmed.

Submissions are reviewed before being merged into `data/` — there may be a
delay between submitting and the data actually appearing here. This is a
manual process for now; it may become more automated as submission volume
grows.

## Behaviour reports

Some things can't be read from a device, only tested. The first is whether a remote accepts and uses **group
bindings**: some remotes only bind to individual lights, some only to a group, and some store a group binding but
never send to it.

ZHA Bindings Manager's "Control lights with this remote" flow (1.1.0+) tests this and offers to share the result as a
`[Behaviour Report]` issue. The ingest workflow stores it in the device's file under `behaviour_reports` (separate
from scan `observations`), and the index rebuild summarises all reports into `data/behaviour.json`, keyed
`<manufacturer_slug>/<model_slug>`, with counts per result (`works`, `partial`, `stored_ignored`, `rejected`) overall
and per firmware. Reports contain the model, firmware, endpoint, clusters, number of lights and result only: no names,
areas or addresses. Each issue counts once; identical results from different people count separately.

## Device answers

A scan shows what a device says it can do. It can't show how it behaves once it's on someone's network: whether it
stays connected, what a press really sends, whether it honours its power-on setting, how long its batteries last.
Device answers fill that gap: people who own a device answer a few questions about it.

- **The questions** are in `data/questions.json`, shared by every tool that asks them. Each has a stable id and preset
  answers, and applies to certain device types (remote, wall switch, light, plug, blind, sensor) and uses. The first
  question is always what the device is used for: a rocker wired to a light and the same rocker used as a remote get
  different questions, and their answers are kept apart.
- **Answering:** ZHA Bindings Manager asks them in a device's side panel (filling in the firmware itself), or anyone
  can use the [Device answers issue form](../../issues/new?template=device-answers.yml), whatever Zigbee system they
  use. The form is generated from `questions.json` by `.github/scripts/build-issue-form.cjs`.
- **Firmware:** every answer is stored with the device's firmware version, and summaries are always per firmware.
- **Free text** ("Other" answers and a tip, up to 280 characters) is cleaned of addresses, e-mail addresses and links,
  and listed in the submission PR for review. It's only published once the PR is merged.
- **Ratings** (1–5, "ignoring price, how good is it at what you use it for?") are shown as a spread, and averaged only
  once 3 people with the same firmware and use have rated.
- **Storage:** each submission is kept in the device's file under `device_answers`. The index rebuild summarises them
  into `data/answers.json`, keyed `<manufacturer_slug>/<model_slug>`, then by firmware and use, with counts per
  answer. `scan_linked` says whether a capability scan for the same firmware is in the database.
- No names, areas or addresses are collected. Like everything here, answers are CC0.

## Zigbee2MQTT model map

`data/z2m-models.json` says which Zigbee2MQTT product code each device belongs to, generated weekly from Zigbee2MQTT's
own device definitions ([zigbee-herdsman-converters](https://github.com/Koenkk/zigbee-herdsman-converters), MIT
licence) by `.github/workflows/z2m-model-map.yml`. Nothing in it is edited by hand. Devices report a Zigbee model
string (what ZHA shows, for example `CH2AX/SWITCH/1`), while zigbee2mqtt.io names device photos by product code
(`41E2PBSWMZ/356PB2MBTZ`); only about a third of the two match. `models` maps model strings to product codes, and
`fingerprints` maps `"<manufacturer>|<model>"` for Tuya-style devices whose model string is shared by many products.

## Using this data

Every record is a plain static JSON file, fetchable directly (e.g. via
`raw.githubusercontent.com`) with no authentication and no API rate limits.
Point any tool at the file for the device you care about.

## License

Dedicated to the public domain under [CC0 1.0](https://creativecommons.org/publicdomain/zero/1.0/).
No attribution required — use it in any project, commercial or otherwise.

```
SONOFF ZBMINIR2        ->  data/sonoff/zbminir2.json
IKEA of Sweden Vallhorn ->  data/ikea-of-sweden/vallhorn.json
```

A single file can contain multiple firmware entries (as an array keyed by
build/firmware version) rather than one file per firmware — that makes it
easy to see how a device's capabilities changed across versions in one
place.

## Contributing

**Automatically:** if you're using a tool that supports it (e.g.
zha-bindings-manager's "Share this scan" feature), it will generate a
pre-filled GitHub issue with your scan data for you to review and submit.

**Manually:** open a new issue labeled `device-submission` with your
manufacturer, model, firmware version, and the cluster/command/attribute
data you've confirmed.

Submissions are reviewed before being merged into `data/` — there may be a
delay between submitting and the data actually appearing here. This is a
manual process for now; it may become more automated as submission volume
grows.

## Using this data

Every record is a plain static JSON file, fetchable directly (e.g. via
`raw.githubusercontent.com`) with no authentication and no API rate limits.
Point any tool at the file for the device you care about.

## License

Dedicated to the public domain under [CC0 1.0](https://creativecommons.org/publicdomain/zero/1.0/).
No attribution required — use it in any project, commercial or otherwise.
