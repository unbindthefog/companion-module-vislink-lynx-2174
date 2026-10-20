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
- [x] Presets: 146 ready-made buttons in seven sections (Signal, Decoder,
      Control — RF / Routing / Video / Unit, Unit)

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

### Measure the usable input-power window (lab)

The power preset alarms above −1 dBm on the assumption that the front end is
compressing by then, but that number is a guess — and a researched one: no
manufacturer in this class publishes a compression point or AGC window, and the
manual's only upper figure is a 2 W CW damage level. See `docs/RF_LEVELS.md`
for the full workings, including why the downconverter is not the limiting
stage here. Worth establishing on a
lab unit with a step attenuator — sweep the level while watching MER and lock,
and note where MER starts to fall off at the top end. Then set the preset
defaults from measurements instead of assumption.

## Later — actions (requires a lab receiver)

**Not to be developed against production hardware.** The write path is
reconstructed from the web UI's JavaScript only (`common/webgui.js`,
`common/custom.js`) and has never been exercised — see
`docs/LYNX_L2174_API.md` §6:

```
GET /common/iframe.php?param=<NAME>&value=<VALUE>
```

- [x] Verify the pattern above against a lab unit, starting with a harmless,
      easily-reversible parameter (`DB_L2174_WEB_TEXT`) — done 2026-10-20 on
      "Rx Relais" (`10.81.5.149`), see `docs/LYNX_L2174_API.md` §6
- [x] Decide which of the 88 GUI-writable parameters are safe and useful as
      Companion actions — a two-tier allowlist in `src/api.ts`: 27 parameters
      are always writable, 8 more only with the connection's "interrupting
      actions" switch (preset recall/store, reboot, and the four downconverter
      supplies, which put DC on an antenna input), and everything else is
      refused whatever the switch says
- [x] Implement — 28 actions, and one Control button per value for the 23 that
      are a choice rather than a number, all built from one table
      (`src/controls.ts`). Preset recall, preset store and
      reboot are absent from the action list until the switch is on, rather
      than present and ignored; `DB_RESTORE_DEFAULTS`, licence entry and key
      material stay refused outright
- [x] Verify on the lab unit (`10.81.5.149`, 2026-10-20): the first six
      actions, preset recall end to end (30 parameters changed, the receiver
      put the recall trigger back to `No` by itself, the IP address untouched),
      and `DB_DECOD_FREEZE_ON_LOSS` from the new batch
- [x] Downconverter power verified on the lab unit (2026-10-20, nothing on the
      coax): `DB_L2174_LNB_PWR_1` set to `On` from a button and read back, then
      back to `Off`. No LNB Fault alarm either way, and the channel's current
      reading did not move — expected with no load. So the parameter is
      writable despite having no GUI page of its own
- [ ] 17 of the 19 new actions are still untested on hardware. None of them
      changes anything a read-back would not report, so this is a test gap
      rather than a risk

Deliberately left out: AES/BISS/EBS key material, licence entry,
`DB_RESTORE_DEFAULTS` and the descrambling type (all refused in `api.ts`);
IP and network configuration (a wrong gateway and the unit is gone);
downconverter type and LO frequency (tied to the hardware actually fitted, and
a wrong value kills reception silently); the CCU and L1500 return path (not
testable without a camera and a modem). `DB_L2174_SET_ALL` is a momentary
trigger that copies channel 1 to all four — not in yet, undecided.

Still open on the control side:

- [ ] Decide how forgiving `settingMatches()` should be (`src/feedbacks.ts`
      carries the `TODO(human)`)
- [ ] No test setup in this repo at all. A hardware-free test over
      `buildVariableValues`, `settingMatches` and the preset ids would cover
      the fiddly parts (`'001'` against `1`, state cleared on contact loss)
- [x] `set_rx_mode` wrote `DB_L2174_RX_MODE` while `rx_mode` read
      `DB_DEMOD_RX_MODE` — fixed 2026-10-20 after the bench unit showed the two
      use different words for the same mode (`DVBT` against `DVB-T`). `rx_mode`
      is now the setting; `rx_mode_detected` is the demodulator's readout
- [ ] Dropdown values are the full sets, hardcoded from `settings.xml`. The
      device also publishes which of them are selectable *right now*
      (`enabled="yes|no"`, and it changes with the receive mode), so the lists
      could be built per connection instead. Bigger change: `settings.xml` would
      have to be fetched and the action definitions rebuilt on connect

## Publishing

- [ ] Register the module name with Bitfocus (Discord `#module-development`)
- [ ] First store submission via the Developer Portal
