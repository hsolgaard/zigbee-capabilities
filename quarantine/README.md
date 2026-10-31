# Quarantined submissions

Records moved out of `data/` because their identity and signature came from a ZHA quirk, not from the device. They are kept here, unchanged, for reference. Nothing in this folder is read by the rebuild, the index or the website.

## 2026-10-31: custom-quirk renamed Tuya devices

All seven were submitted from ZHA installs running local custom quirks that use `friendly_name()` and replace the device signature:

- The manufacturer is a bare Tuya suffix (e.g. `46t1rvdu` instead of `_TZ3000_46t1rvdu`).
- The model is a user-chosen label (e.g. `Moes-2-gang`, `WHD02-Aubess`), not the device's Zigbee model identifier.
- Endpoint 1 reports `device_type 0xffff` with `CustomBasicCluster` / `CustomMultistateInputCluster`. That's the quirk's replacement signature, so the clusters and capabilities don't describe the physical device.

| File | Submitted as | Source issue |
|---|---|---|
| `18ejxno0/moes-2-gang.json` | 18ejxno0 / Moes-2-gang | #305 |
| `46t1rvdu/whd02-aubess.json` | 46t1rvdu / WHD02-Aubess | #264 (real record: `data/tz3000-46t1rvdu/ts0001.json`) |
| `4rbqgcuv/ts0001-avb.json` | 4rbqgcuv / TS0001-AVB | #266 |
| `gjrubzje/ts0001-ztu.json` | gjrubzje / TS0001-ZTU | #288 |
| `hhiodade/moes-1-gang.json` | hhiodade / Moes-1-gang | #284 |
| `pf7swkqp/ts0003-sb.json` | pf7swkqp / TS0003-SB | #183 (real record: `data/tz3000-pf7swkqp/ts0003.json`) |
| `tqlv4ug4/ts0001-custom.json` | tqlv4ug4 / TS0001-custom | #286 |

They weren't merged into the real records, because the capability data reflects the quirk and would contaminate genuine scans. To recover them, rescan the devices with a card version that reads the raw Basic manufacturer/model and the raw ZDO simple descriptors.

## 2026-10-31: submission with no manufacturer or model

| File | Submitted as | Source issue |
|---|---|---|
| `unknown/unknown.json` | (null) / (null): a colour light (0x0300, Touchlink), sw_build_id 1.0.7 | #97 (card 0.20.1) |

Indexed as "unknown / unknown", so it couldn't be searched or matched to a device. Rescan to recover it.
