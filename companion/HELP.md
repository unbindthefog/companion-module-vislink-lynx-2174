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
For a green/orange/red battery readout, give the button a green base style and
add two instances of **Camera battery voltage crosses threshold**:

| Order | Threshold | Style  | Shows              |
| ----- | --------- | ------ | ------------------ |
| 1st   | 12.5 V    | orange | getting low        |
| 2nd   | 11.8 V    | red    | change the battery |

Below 11.8 V both match, and the red one wins because it is listed second.
The same pattern works for power, MER and temperature.

## Presets

The module ships 21 ready-made buttons, grouped in three sections you can drag
straight onto a page:

| Section     | Buttons                                                                 |
| ----------- | ----------------------------------------------------------------------- |
| **Signal**  | RF lock, input power and MER — one of each per channel (1–4)            |
| **Decoder** | Video lock, detected video format, audio 1 + 2 lock                     |
| **Unit**    | Alarm status, camera battery, the three temperatures, and unit identity |

Lock buttons start red and turn green once the receiver reports lock, so a
healthy rack reads green at a glance. The readouts start neutral and colour
themselves when a threshold is crossed. The camera battery preset comes with
the two-feedback traffic light described above already wired up.

Presets are a starting point — thresholds, colours and text are all yours to
edit once the button is on the page.

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
