# Vislink Lynx L2174

Monitors a Vislink Lynx L2174 RF broadcast receiver through its built-in
`data.xml` status page and exposes the receiver's state as Companion variables
and feedbacks.

**Read only.** A switch per connection turns the module into a pure monitor:
variables and feedbacks keep working, and there are no actions at all — nothing
to place on a button by mistake, and a button that already carries one cannot
reach the receiver either, because the refusal also sits in the client. The
connection list shows `Read only` while it is on. That is the right setting for
a receiver that is on air.

**What it may change**, when that switch is off. The module reads freely and writes only the 35
parameters its actions need — reception, routing, video output and the status
pin. Everything else the receiver would accept is refused in the client itself,
so a mistake cannot reach it: key material, licence entry, restoring defaults
and the network configuration are never written, whatever the module is asked
to do. Eight of the 35 are hidden until you switch them on per connection:
preset recall and store, reboot, and downconverter power (see Configuration).

The receiver has no authentication: anything that can reach it on the network
can reconfigure it. That is a property of the device, not of this module, and
it is the reason the list of writable parameters is a short allowlist rather
than a list of things to avoid.

## Configuration

| Field                | Notes                                                                                                       |
| -------------------- | ----------------------------------------------------------------------------------------------------------- |
| Receiver address     | IP address or hostname of the L2174.                                                                        |
| Port                 | Normally `80`.                                                                                              |
| Poll interval        | How often status is fetched. `2` seconds is a good default; the receiver's own web UI polls every 1 second. |
| Read only            | Off by default. While on there are no actions, no control presets, and nothing is ever written.             |
| Interrupting actions | Off by default, and hidden while read only is on. Preset recall and store, reboot and downconverter power.  |

There is nothing to configure about the transport — the receiver serves
`data.xml` over plain HTTP with no authentication.

## Variables

### Unit

| Variable                   | Example   |
| -------------------------- | --------- |
| `unit_web_id`              | `K7`      |
| `unit_serial`              | `0314525` |
| `unit_sw_version`          | `3.04`    |
| `unit_build`               | `V1039`   |
| `unit_run_hours`           | `13211`   |
| `unit_temperature`         | `40.0`    |
| `demod_fpga_temperature`   | `73`      |
| `decoder_fpga_temperature` | `77`      |
| `camera_battery_voltage`   | `15.1`    |

### RF / demodulator

| Variable               | Example              | Notes                                          |
| ---------------------- | -------------------- | ---------------------------------------------- |
| `rx_mode`              | `LMST(S)`            | the mode as **set** — `DVBT`, not `DVB-T`      |
| `rx_mode_detected`     | `DVB-T`              | the same mode as the demodulator reports it    |
| `rf_frequency`         | `2.325000`           |                                                |
| `rf_bandwidth`         | `10MHz`              |                                                |
| `rf_modulation`        | `16QAM`              | read-only on this receiver, taken from the TPS |
| `rf_fec`               | `2/3`                | read-only, likewise                            |
| `rf_guard_interval`    | `Auto`               |                                                |
| `spectral_polarity`    | `Normal`             |                                                |
| `pre_ber` / `post_ber` | `0`                  |                                                |
| `asi_input_lock`       | `Locked` / `No Lock` |                                                |
| `ip_input_lock`        | `Locked` / `No Lock` |                                                |
| `preset_slot`          | `001`                | the slot **selected**, not the one in force    |

The receiver spells its receive mode two different ways, and the difference
matters when you compare one against a value you typed: `rx_mode` is what the
mode is set to and what the action writes, `rx_mode_detected` is the
demodulator's own readout.

### Routing

| Variable            | Example                                        |
| ------------------- | ---------------------------------------------- |
| `decoder_source`    | `Ext ASI` / `Demodulator` / `Diversity` / `IP` |
| `asi_output_source` | same set                                       |
| `ip_output_source`  | same set, plus `Off`                           |
| `demod_diversity`   | `On` / `Off`                                   |
| `asi_diversity`     | `On` / `Off`                                   |
| `diversity_delay`   | `Auto` / `Off`                                 |

### Per-channel signal quality

The receiver has four RF input channels. For each:

- `channel1_lock` … `channel4_lock` — `Locked` / `No Lock`
- `channel1_power` … `channel4_power` — input power level in dBm
- `channel1_mer` … `channel4_mer` — modulation error ratio in dB
- `channel1_enabled` … `channel4_enabled` — whether it joins the combination
- `channel1_lnb_power` … `channel4_lnb_power` — downconverter supply, `On` / `Off`

`channelN_lnb_power` says the supply is switched on, not that voltage reached
anything: with nothing on the coax the receiver reports no current and raises no
LNB fault, so there is no second reading to confirm it against.

### Decoder and camera control

| Variable             | Example                           |
| -------------------- | --------------------------------- |
| `video_locked`       | `Locked` / `No Lock`              |
| `video_format`       | `1080I/50`                        |
| `video_input_mode`   | `H264` — the codec it expects     |
| `genlock`            | `Off` / `SD` / `HD`               |
| `genlock_error`      | `OK` / `Fail`                     |
| `freeze_on_loss`     | `Freeze` / `Blue`                 |
| `video_output_1`     | `SDI` / `SDI+Overlay`             |
| `video_output_2`     | same, plus the composite variants |
| `overlay_type`       | `Basic` / `Service`               |
| `overlay_background` | `Off`, or `10`–`100`              |
| `overlay_colour`     | `White` / `Green`                 |
| `audio1_locked`      | `Locked` / `No Lock`              |
| `audio2_locked`      | `Locked` / `No Lock`              |
| `ccu_status`         | `Not Detected`                    |

### Status pin

| Variable                 | Example            |
| ------------------------ | ------------------ |
| `status_pin_mode`        | `Alarm` / `Manual` |
| `status_pin_alarm_level` | `High` / `Low`     |

The receiver reports exactly one of these two at a time, depending on the pin
mode: `status_pin_state` while the mode is `Manual`, `status_pin_alarm_level`
while it is `Alarm`. The other is empty. Both can be _set_ in either mode and
the value sticks — it is only the reading that comes and goes, so a button for
the one currently out of view will not turn green even though it worked.

### Alarms

| Variable        | Example                                                |
| --------------- | ------------------------------------------------------ |
| `alarm_active`  | `yes` / `no`                                           |
| `alarm_summary` | `High Temperature, RF not Locked`, or empty when clear |

`alarm_summary` is decoded from the receiver's own alarm bitfield — see
`docs/LYNX_L2174_API.md` §5 for the full bit-to-name mapping.

### Diagnostics

`last_error` holds the most recent connection error, or is empty while the
connection is healthy.

## Feedbacks

- **RF channel is locked** — true while the chosen channel (1–4) reports RF
  lock. Use directly for a green "locked" button, or inverted for a red alarm
  button.
- **Video decoder is locked** — true while the decoder reports video lock.
- **Any alarm is active** — red while the receiver's alarm bitfield reports at
  least one active condition.
- **Channel power crosses threshold** — red when the chosen channel (or the
  strongest of the four) crosses a configurable dBm threshold, in whichever
  direction (below/above) you pick.
- **Channel MER crosses threshold** — red when the chosen channel (or the
  cleanest of the four) crosses a configurable dB threshold, in whichever
  direction you pick.
- **Temperature crosses threshold** — red when the chosen sensor (unit, demod
  or decoder FPGA) crosses a configurable °C threshold, in whichever direction
  you pick.
- **Camera battery voltage crosses threshold** — red when the camera supply
  voltage crosses a configurable V threshold, in whichever direction you pick.

### Building a traffic-light button

Companion applies boolean feedbacks in order, so the last matching one wins.
For a green/orange/red readout, give the button a green base style and stack
two threshold feedbacks — for the battery, two instances of **Camera battery
voltage crosses threshold**:

| Order | Threshold | Style  | Shows              |
| ----- | --------- | ------ | ------------------ |
| 1st   | 12.5 V    | orange | getting low        |
| 2nd   | 11.8 V    | red    | change the battery |

Below 11.8 V both match, and the red one wins because it is listed second.

The MER presets ship this pattern already: green above 22 dB, orange down to
16 dB, red below that.

Input power gets the same treatment, but as a **window** rather than a floor —
too much signal overloads the receiver's front end and costs you lock just as
surely as too little. Its preset stacks four feedbacks: green from −6 to
−70 dBm, orange from −70 to −80 and from −6 to −1, red below −80 and above −1.

## Presets

The module ships 105 ready-made buttons you can drag straight onto a page, or
146 with the interrupting actions switched on — and 21, the monitoring ones
alone, under read only.
Monitoring first, then one button per value for everything the actions can set:

| Section               | Buttons                                                                      |
| --------------------- | ---------------------------------------------------------------------------- |
| **Signal**            | RF lock plus power and MER as traffic lights — one of each per channel (1–4) |
| **Decoder**           | Video lock, detected video format, audio 1 + 2 lock                          |
| **Control — RF**      | Receive mode, bandwidth, guard interval, polarity, channel enable, retune    |
| **Control — Routing** | Decoder source, ASI and IP output source, the three diversity inputs, delay  |
| **Control — Video**   | Video input mode, genlock, on-signal-loss, both output formats, the overlay  |
| **Control — Unit**    | Status pin mode, state and alarm level                                       |
| **Unit**              | Alarm status, camera battery, the three temperatures, and unit identity      |

With **interrupting actions** on, Control — RF gains downconverter power per
channel, and Control — Unit gains recall and store for all 16 preset slots plus
reboot.

The per-channel controls — channel enable, and downconverter power when it is
switched on — put all four channels in one group rather than one group each.
The channel is on the button itself (`RF1`…`RF4`, `LNB1`…`LNB4`).

**Control buttons show what is set, not just what they would do.** Each carries
a _setting is_ feedback and turns green while the receiver already holds that
value, so a row of them reads at a glance as "this is the one we are on". Three
kinds stay dark on purpose: preset recall, because the receiver only reports
which slot is _selected_ and not which one is still in force; the status pin
state while the pin mode is `Alarm`, because the receiver only reports it in
`Manual`; and store and reboot, which
are red instead, because neither can be taken back.

Lock buttons start red and turn green once the receiver reports lock, so a
healthy rack reads green at a glance. The power, MER and camera battery
presets are traffic lights — green, then orange, then red as the reading
degrades, with power alarming at both ends of its window. The remaining
readouts start neutral and only colour themselves once their single threshold
is crossed.

Presets are a starting point — thresholds, colours and text are all yours to
edit once the button is on the page.

## Actions

| Action                        | Effect                                                                                                                          |
| ----------------------------- | ------------------------------------------------------------------------------------------------------------------------------- |
| **Set receive frequency**     | Retunes the demodulator. The link drops until the transmitter matches.                                                          |
| **Set channel bandwidth**     | `2MHz`–`12MHz`, or `Auto`. Takes up to three seconds to apply — the slowest write on the unit.                                  |
| **Set receive mode**          | `DVBT`, `LMST(S)` or `LMST(D)`. Re-acquires the signal.                                                                         |
| **Set decoder source**        | Which input feeds the decoder: demodulator, external ASI, diversity or IP.                                                      |
| **Set demodulator diversity** | On or off.                                                                                                                      |
| **Set guard interval**        | `1/32`, `1/16`, `1/8`, `1/4` or `Auto`. Fixing it shortens acquisition.                                                         |
| **Set spectral polarity**     | `Normal`, `Inverted` or `Auto`.                                                                                                 |
| **Set channel enable**        | Takes one diversity input (1–4) in or out of the combination.                                                                   |
| **Set ASI output source**     | What feeds the ASI output.                                                                                                      |
| **Set IP output source**      | What feeds the IP output, or `Off`.                                                                                             |
| **Set ASI diversity input**   | Whether the external ASI input joins the diversity combination.                                                                 |
| **Set diversity delay**       | `Auto` lines up inputs arriving over different path lengths.                                                                    |
| **Set video input mode**      | Which codec the decoder expects. The wrong one gives no picture, not a bad one.                                                 |
| **Set frame lock (genlock)**  | `Off`, `SD` or `HD`. `genlock_error` says whether it took.                                                                      |
| **Set on signal loss**        | What the output shows when the link drops: the last frame, or blue.                                                             |
| **Set video output 1 / 2**    | `SDI` or `SDI+Overlay`; output 2 also does composite on units fitted for it.                                                    |
| **Set overlay type**          | `Basic` or `Service`. Only visible on an output set to `+Overlay`.                                                              |
| **Set overlay background**    | How solid the strip behind the text is: `Off`, or 10–100 percent.                                                               |
| **Set overlay colour**        | `White` or `Green`.                                                                                                             |
| **Set status pin mode**       | Whether the status pin follows the alarm state or is driven by hand.                                                            |
| **Set status pin state**      | Drives the pin directly. Only has an effect — and is only reported back — in `Manual` mode.                                     |
| **Set status pin level …**    | Which level the pin takes when an alarm is active.                                                                              |
| **Set web ID**                | The name the receiver shows in its own interface. Harmless; an empty value is refused because the old name cannot be recovered. |

With **interrupting actions** switched on, four more appear:

| Action                      | Effect                                                                                                      |
| --------------------------- | ----------------------------------------------------------------------------------------------------------- |
| **Recall preset**           | Loads a stored configuration — frequency, bandwidth, mode and routing change at once.                       |
| **Store preset**            | Overwrites the chosen slot with the current settings. The previous contents are gone.                       |
| **Reboot receiver**         | Off air for about a minute.                                                                                 |
| **Set downconverter power** | Puts DC on an antenna input (1–4) to feed a downconverter. Whatever is on the far end of that coax gets it. |

Switching the setting back off removes them from the list again, but a button
that already carries one keeps it and goes quiet: pressing it does nothing
until the setting is on again. Nothing on the button says so — worth knowing
before wondering why it stopped working. The same is true under read only,
except there the connection list says `Read only`, which is at least a place to
look.

One thing not to do: press two buttons for the **same** setting in quick
succession. `Set video input mode` takes about three seconds and reconfigures
the decoder, and it does not simply lag — write three values with five seconds
between them and the receiver settles on the _first_ one; with eight seconds,
on the middle one. The last press does not reliably win. Set it once and let it
be; the read-back will tell you if it did not take.

Writes are read back. The receiver answers every write with `200` even when it
discards the value, so the module polls again afterwards and logs a warning if
the parameter still does not read what was set. Each parameter is tracked on
its own, so pressing several buttons in quick succession does not cancel the
earlier checks. The momentary triggers (recall, store, reboot) are not checked: they reset
themselves the moment the receiver acts, so there is nothing to read back. The
two status pin levels are checked when they are readable and left unchecked
when the pin mode has put them out of view — absent is not the same as
rejected.

The value lists are the full sets the receiver accepts, not what it will take
right now — it narrows them depending on the mode (in LMS-T it offers only
6/7/8 MHz of bandwidth). Setting one it does not currently want is answered
with `200` and discarded, and the read-back is what tells you.

## Polling and load on the receiver

The receiver writes `/data.xml` on its own one-second timer whether anyone
reads it or not, and `lighttpd` then serves it as a plain static file — asking
for it does **not** make the receiver gather anything. A poll costs it a socket
it already has open, a `stat()` and 26 kB: measured at about 11 ms per request,
with no degradation over repeated requests. At the default two-second interval
that is roughly half a percent of the web server's time; the receiver's own web
interface polls harder than we do, at 1 Hz.

So a single connection is comfortably within what the device does for itself.
Worth keeping in mind anyway on a 2011-vintage receiver:

- **One connection per receiver.** Companion does not notice if you add the
  same receiver twice, and two connections poll twice as often. If you need the
  values on several pages, reference the one connection's variables from all of
  them.
- **Count the other readers too.** Every open browser tab of the receiver's own
  web interface adds 1 Hz, and any dashboard or monitoring system polling the
  same unit adds its own share. Raise the interval if several systems watch one
  receiver.
- **The module backs off on its own.** After a failed poll it retries at the
  normal interval, then doubles the gap on each further failure up to 30
  seconds, and returns to normal on the first success. A receiver that is
  rebooting or already struggling is not knocked on every two seconds. The
  connection status shows when the next attempt is due.

Nothing this module sends changes device state: it only ever issues `GET` for a
static file, so there is no configuration write and no flash wear involved.

## Behaviour when the receiver is unreachable

The connection goes to _Connection Failure_ with an explanatory message, and
all device-derived variables are blanked. This is deliberate: a frozen power
reading that looks live is more dangerous in a production environment than an
obviously empty one.

## Troubleshooting

| Symptom                                          | Cause                                                                                                        |
| ------------------------------------------------ | ------------------------------------------------------------------------------------------------------------ |
| `Connection refused`                             | Wrong port, or the receiver's web interface is not running.                                                  |
| `Host unreachable` / `No route to …`             | The receiver is on a different network or VLAN than the Companion machine.                                   |
| `HTTP 404` / non-200 for `/data.xml`             | Firmware or URL path differs from what this module expects — please open an issue with the firmware version. |
| Variables stay empty but the connection is green | The receiver returned an unexpected shape. Enable debug logging and open an issue.                           |
