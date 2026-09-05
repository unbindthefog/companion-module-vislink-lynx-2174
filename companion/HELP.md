# Vislink Lynx L2174

Monitors a Vislink Lynx L2174 RF broadcast receiver through its built-in
`data.xml` status page and exposes the receiver's state as Companion variables
and feedbacks.

**This module is read-only.** It polls status and never writes to the
receiver, so it cannot change frequency, presets or any other setting. Adding
actions is planned, but only after the write path has been validated against a
lab receiver — see `ROADMAP.md`.

## Configuration

| Field            | Notes                                                                                                       |
| ---------------- | ----------------------------------------------------------------------------------------------------------- |
| Receiver address | IP address or hostname of the L2174.                                                                        |
| Port             | Normally `80`.                                                                                              |
| Poll interval    | How often status is fetched. `2` seconds is a good default; the receiver's own web UI polls every 1 second. |

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

| Variable               | Example              |
| ---------------------- | -------------------- |
| `rx_mode`              | `LMST(S)`            |
| `rf_frequency`         | `2.325000`           |
| `rf_bandwidth`         | `10MHz`              |
| `rf_modulation`        | `16QAM`              |
| `rf_fec`               | `2/3`                |
| `rf_guard_interval`    | `Auto`               |
| `pre_ber` / `post_ber` | `0`                  |
| `asi_input_lock`       | `Locked` / `No Lock` |
| `ip_input_lock`        | `Locked` / `No Lock` |

### Per-channel signal quality

The receiver has four RF input channels. For each there are three variables:

- `channel1_lock` … `channel4_lock` — `Locked` / `No Lock`
- `channel1_power` … `channel4_power` — input power level in dBm
- `channel1_mer` … `channel4_mer` — modulation error ratio in dB

### Decoder and camera control

| Variable        | Example              |
| --------------- | -------------------- |
| `video_locked`  | `Locked` / `No Lock` |
| `video_format`  | `1080I/50`           |
| `audio1_locked` | `Locked` / `No Lock` |
| `audio2_locked` | `Locked` / `No Lock` |
| `ccu_status`    | `Not Detected`       |

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

The module ships 21 ready-made buttons, grouped in three sections you can drag
straight onto a page:

| Section     | Buttons                                                                      |
| ----------- | ---------------------------------------------------------------------------- |
| **Signal**  | RF lock plus power and MER as traffic lights — one of each per channel (1–4) |
| **Decoder** | Video lock, detected video format, audio 1 + 2 lock                          |
| **Unit**    | Alarm status, camera battery, the three temperatures, and unit identity      |

Lock buttons start red and turn green once the receiver reports lock, so a
healthy rack reads green at a glance. The power, MER and camera battery
presets are traffic lights — green, then orange, then red as the reading
degrades, with power alarming at both ends of its window. The remaining
readouts start neutral and only colour themselves once their single threshold
is crossed.

Presets are a starting point — thresholds, colours and text are all yours to
edit once the button is on the page.

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
