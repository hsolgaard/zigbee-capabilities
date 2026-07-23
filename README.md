# ZHA Device Capabilities

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
