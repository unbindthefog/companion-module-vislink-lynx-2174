# RF level and MER reference

Where the preset thresholds in `src/presets.ts` come from, and what is still
guesswork. Gathered while building the power and MER traffic lights, so a later
pass does not have to re-derive it — or quietly "fix" numbers that were chosen
deliberately.

## What the receiver's own documentation gives

From the product manual, _Vislink "Lynx Receiver L2174, L2074, L2170"_,
CL140072 Issue 2.0, September 2011 (firmware basis V0013 — our units run
V1039 / SW 3.04, so the manual predates them considerably):

| Figure               | Value                                                    | Page |
| -------------------- | -------------------------------------------------------- | ---- |
| Sensitivity          | −93 dBm typ. @ DVB-T QPSK 1/2, per ETSI ES 202 239       | 7, 9 |
| Max input            | **2 W CW (≈ +33 dBm) — explicitly a _damage_ level**     | 9    |
| RF input             | 4 × 75 Ω BNC, UHF 70–860 MHz                             | 9    |
| Downconverter supply | +20 VDC, 400 mA per connector, short-circuit protected   | 9    |
| Frame lock           | SD black & burst or HD tri-level, **adds 0–40 ms delay** | 10   |
| Diversity            | Maximal Ratio Combining across the 4 RF inputs           | 6, 7 |
| MER display          | Bar graph, scale 0/10/20/30 dB                           | 13   |

Deliberately **absent** from the manual: any AGC window, any recommended
operating level range, any compression point, any MER threshold per
modulation/FEC, and any explanation of the −150…+10 dBm range the web UI
reports. The L3025 downconverter is not mentioned at all.

## Sensitivity at 16QAM 2/3

The manual's −93 dBm is for QPSK 1/2, the most robust mode. Our links run
16QAM 2/3, which needs more C/N. From ETSI EN 300 744 Annex A (required C/N
for BER 2×10⁻⁴ after Viterbi, non-hierarchical):

| Modulation | Code rate | Gaussian | Ricean F1 | Rayleigh P1 |
| ---------- | --------- | -------- | --------- | ----------- |
| QPSK       | 1/2       | 3.5 dB   | 4.1 dB    | 5.9 dB      |
| 16QAM      | 1/2       | 9.3 dB   | 9.8 dB    | 11.8 dB     |
| 16QAM      | 2/3       | 11.4 dB  | 12.1 dB   | 15.3 dB     |

The absolute values shift by a few tenths of a dB between revisions and channel
models; the part that matters is stable: **QPSK 1/2 → 16QAM 2/3 costs ≈ 8 dB**.

Applied to the manual's figure, sensitivity at 16QAM 2/3 works out at roughly
**−85 dBm**, about 1 dB worse again in the 10 MHz LMS-T mode (wider noise
bandwidth) — so call it **≈ −84 dBm**. EBU field measurements of ten real DTT
receivers came out about 1 dB worse than the ETSI table, which puts the
practical cliff near **−83 dBm**.

This is what the low-end preset defaults are built on: red below −80 dBm sits a
few dB above the cliff rather than on it, and orange below −70 dBm warns well
ahead of it. That derivation is ours — Vislink publishes no 16QAM figure.

## The upper end is still unmeasured

No manufacturer in this class — Vislink, Domo, Silvus, Teradek — publishes a
1 dB compression point or an AGC window for their COFDM receivers. The only
documented upper figure for the L2174 is the 2 W CW damage level, which says
nothing about where the front end starts to compress and lose lock.

So the high-side preset defaults (orange above −6 dBm, red above −1 dBm) are an
assumption, not a specification. See `ROADMAP.md` for the lab item to measure
the real window with a step attenuator.

Two things do inform it:

- **COFDM has a high peak-to-average ratio.** A comfortable-looking _average_
  input level can still have peaks driving the mixer into compression, which
  shows up as intermodulation between subcarriers and a collapsing MER while
  the level reading looks fine. MER is the more sensitive indicator at both
  ends of the window; level tells you which end you are at.
- **The downconverter will not save us.** The L3025 datasheet gives 26 dB gain
  (low) / 41 dB (typ. high), NF < 1.5 dB, OP1dB > +14 dBm, OIP3 > +26 dBm. Its
  output can therefore reach roughly +14 dBm before it compresses — far above
  our red zone — so whatever compresses first at these levels is the receiver,
  not the converter.

### A practical consequence of the downconverter gain

We measure at the receiver's UHF input, which is the downconverter's _output_,
so the converter's gain setting shifts the whole window. In high-gain mode
(41 dB) an S-band level of −40 dBm at the antenna already arrives at +1 dBm —
inside the red zone. The same signal in low-gain mode (26 dB) arrives at
−14 dBm, comfortably green. A camera working close to the receive antenna can
therefore overload the input in high-gain mode, and the fix is the converter's
gain setting rather than the alarm threshold.

It also means thresholds tuned on this link do not transfer unchanged to a
chain with a different downconverter.

## MER thresholds

The preset uses orange below 22 dB and red below 16 dB. Against the table
above, 16 dB sits just above the required C/N for 16QAM 2/3 under Rayleigh
conditions (15.3 dB) — which is the realistic model for a moving camera — so red
fires as the link reaches the edge rather than after it has gone. (MER and C/N
are not the same quantity, MER also carries implementation impairments, but
they track closely enough for setting an alarm.)

No vendor-confirmed MER threshold exists for this receiver. The common practice
of holding 3–6 dB above the failure point would suggest an alarm somewhere
around 14–17 dB, which is where 16 dB lands.

## Sources

- Product manual CL140072 Issue 2.0 — local copy; also mirrored at
  <https://www.manualslib.com/manual/897172/Vislink-Lynx-L2174.html>
- L2174 datasheet — <https://rf-support.nl/wp-content/uploads/2023/03/Datasheet-L2174-V3.pdf>
- ETSI EN 300 744 V1.6.1, Annex A —
  <https://www.etsi.org/deliver/etsi_en/300700_300799/300744/01.06.01_60/en_300744v010601p.pdf>
- EBU Technical Review 296, DTT field measurements —
  <https://tech.ebu.ch/docs/techreview/trev_296-dtt_qam.pdf>
- L3025 downconverter datasheet (11/2024) —
  <https://www.vislink.com/wp-content/uploads/2024/11/L3025-Datasheet-11-24-FINAL.pdf>
