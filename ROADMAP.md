# Roadmap

## Now — scaffold (v0.1)

This is the initial skeleton: repo, build tooling, and a first cut of the
read-only monitoring path, modelled on
[`companion-module-domo-rxd4`](https://github.com/unbindthefog/companion-module-domo-rxd4).
The parameter names and values it maps were confirmed against a live,
production L2174 via read-only `curl` (see `docs/LYNX_L2174_API.md`), and the
module has since been loaded into a real Companion instance and verified live
against that same receiver (all 39 variables populate correctly; see the
"Verified against real hardware" note below).

- [x] `data.xml` reverse-engineered read-only against a production receiver
- [x] Parameter reference with Klartext labels/ranges (`docs/LYNX_L2174_API.md`)
- [x] Minimal HTTP client + `data.xml` parser (`src/api.ts`)
- [x] Variables: unit info, RF/demod status, per-channel lock/power/MER, decoder, alarms
- [x] Feedbacks: channel lock, video lock, alarm active, and
      power/MER/temperature/voltage threshold — each with a below/above
      direction rather than the comparison baked into the name
- [x] Load the module into a real Companion instance and verify against the receiver
- [x] Presets: 21 ready-made buttons in three sections (Signal / Decoder / Unit)

### Verified against real hardware (2026-09-04)

Loaded via Companion's developer-modules path against a production L2174
(`10.81.5.131`, Web ID "K7", build V1039). All 39 variables came through with
live values (channel lock/power/MER, temperatures, BER, alarms); connection
status green, no errors logged.

One environment issue surfaced and was resolved along the way, unrelated to
this module's code — noted here in case it recurs for other dev modules:
Companion 5.0.3 failed to fully initialize _any_ dev module (this one and
`companion-module-domo-rxd4` both hit an immediate `Error: Restart forced`
crash loop). Updating to Companion 5.0.5 fixed it. Separately,
`dev_modules_path` should point at a small dedicated folder of symlinks (e.g.
`~/companion-dev-modules`), not at a large shared directory containing
unrelated projects — pointing it at the latter made Companion's file watcher
recurse into every sibling project's `node_modules`, which produced
`EMFILE: too many open files` and a spurious self-referential symlink.

## Next — more monitoring depth

`data.xml` carries 248 live parameters; only a curated subset is mapped so
far (see `docs/LYNX_L2174_API.md` §3 for everything available). Worth adding
once the basics are proven:

- Audio channel detail (standard, mode, sample rate — currently only lock
  state for channels 1/2)
- Diversity status (`DB_L2174_*_DIVERSITY`, `DB_DEMOD_PKT_DIV_SELECT`)
- ASI/IP routing state (`DB_DEMOD_ASI*_OUTPUT_MUX`, `DB_DEMOD_IP1_OUTPUT_MUX`)
- Self-test bitfield (`DB_DEMOD_SELFTEST_RESULTS`), decoded the same way as alarms
- LNB current per channel (`DB_DEMOD_CURRENT_1..4`)
- Genlock — the L2174 calls it "Frame Lock" and exposes far less than the
  RXD4's `genlock` module (no reference format, no per-output buffer delays):
  `DB_DECOD_GEN_LOCK` (`Off`/`SD`/`HD`, the setting), `DB_DECOD_GEN_LOCK_ERROR`
  (`OK`/`Fail`, the state worth alarming on), `DB_DECOD_PCR_LOCK`,
  `DB_DECOD_LINE_OFFSET` (pixel offset) and `DB_DECOD_PSF_MODE`. Deferred to
  the lab setup on purpose: on the production unit, PCR lock read `No Lock`
  while frame lock reported `OK` on the `SD` reference, so the interplay
  between the two needs a unit we can reconfigure before mapping it.

Open questions:

- `settings.xml` gives Klartext labels, units and ranges for every parameter
  the receiver knows about. Could the module load it once at connect time and
  derive (part of) its own variable list from it, instead of hard-coding
  names? Worth prototyping once the hard-coded set has proven itself.
- Bitfield lengths (`DB_L2174_ALARMS` and friends) vary slightly by firmware
  build — confirm the padding behaviour described in the API doc holds across
  more than the one firmware version this was explored on (`V1039`).

## Later — actions (requires a lab receiver)

**Not to be developed against production hardware.** The write path is
reconstructed from the web UI's JavaScript only (`common/webgui.js`,
`common/custom.js`) and has never been exercised — see
`docs/LYNX_L2174_API.md` §6:

```
GET /common/iframe.php?param=<NAME>&value=<VALUE>
```

- [ ] Verify the pattern above against a lab unit, starting with a harmless,
      easily-reversible parameter (e.g. `DB_L2174_WEB_TEXT`)
- [ ] Decide which of the 38 GUI-writable parameters are safe and useful as
      Companion actions
- [ ] Implement, with confirmation-style presets for anything disruptive
      (`DB_L2174_REBOOT`, `DB_L2174_PRESET_STORE`/`_RECALL`,
      `DB_RESTORE_DEFAULTS` — the web UI itself requires a JS confirmation
      dialog for these)

Candidate actions, pending the above: frequency/bandwidth/modulation change,
preset recall, ASI/IP routing change. Whether any of these are safe to expose
without additional guardrails is unknown until tested on a lab unit.

## Publishing

- [ ] Register the module name with Bitfocus (Discord `#module-development`)
- [ ] First store submission via the Developer Portal
