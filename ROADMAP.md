# Roadmap

## Now — scaffold (v0.1)

This is the initial skeleton: repo, build tooling, and a first cut of the
read-only monitoring path, modelled on
[`companion-module-domo-rxd4`](https://github.com/unbindthefog/companion-module-domo-rxd4).
The parameter names and values it maps were confirmed against a live,
production L2174 via read-only `curl` (see `docs/LYNX_L2174_API.md`) — the
module code itself has **not yet been run inside Companion against that
device**.

- [x] `data.xml` reverse-engineered read-only against a production receiver
- [x] Parameter reference with Klartext labels/ranges (`docs/LYNX_L2174_API.md`)
- [x] Minimal HTTP client + `data.xml` parser (`src/api.ts`)
- [x] Variables: unit info, RF/demod status, per-channel lock/power/MER, decoder, alarms
- [x] Feedbacks: channel lock, video lock, alarm active, power threshold, temperature threshold
- [ ] Load the module into a real Companion instance and verify against the receiver
- [ ] Presets: per-channel RF-lock button, alarm-summary readout

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
