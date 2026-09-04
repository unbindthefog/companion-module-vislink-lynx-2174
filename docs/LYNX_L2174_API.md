# 📡 Vislink Lynx L2174 Receiver – API & Schnittstellen

**Gerät**: Vislink Lynx L2174
**Typ**: HF-Broadcast-Videoempfänger (RF-Demodulator + HEVC/H.264/MPEG-2-Decoder, DVB-T / LMST)
**Schnittstelle**: HTTP (Port 80, `lighttpd/1.4.15`)
**Protokoll**: Statische XML-Dateien + Query-String-CGI (kein REST, kein JSON)
**Web-UI**: `http://<L2174-IP>/` (Frameset: sichtbarer Rahmen + verstecktes `setting_frame`)
**Authentifizierung**: keine

---

## 🔍 Übersicht

| Kategorie                                        | Typ | Pattern                                        | Format                       | Aktualisierung                                   |
| ------------------------------------------------ | --- | ---------------------------------------------- | ---------------------------- | ------------------------------------------------ |
| **Live-Telemetrie**                              | GET | `/data.xml`                                    | XML, flache Name/Value-Liste | GUI pollt alle **1000 ms**                       |
| **Metadaten** (Labels, Einheiten, Wertebereiche) | GET | `/settings.xml`                                | XML                          | statisch, selten geladen                         |
| **Einstellung ändern**                           | GET | `/common/iframe.php?param=<NAME>&value=<WERT>` | Query-String                 | synchron, Antwort im versteckten `setting_frame` |
| **GUI-Seiten**                                   | GET | `/common/<seite>.html`                         | HTML + JS-Gerüst             | einmalig beim Laden                              |

Der L2174 ist die technisch einfachste der drei hier dokumentierten Domo/Vislink-Plattformen: kein Modulsystem wie beim RXD4 (MASH REST API), kein JSON wie beim Nano HEVC TX — sondern zwei statische XML-Dateien, die die komplette Web-GUI per clientseitigem JavaScript (`common/webgui.js`) befüllen. Für ein Monitoring-Tool bedeutet das: **ein** Endpunkt (`/data.xml`) liefert praktisch den gesamten Gerätezustand.

---

## 1. Live-Telemetrie: `/data.xml`

**Endpunkt**: `GET http://<L2174-IP>/data.xml`

Liefert alle 248 aktuell belegten Parameter als flache `<name>`/`<value>`-Paare. Kein Nesting, keine Gruppierung — die Zuordnung zu einer Funktionseinheit ergibt sich nur aus dem Namenspräfix (`DB_DEMOD_*`, `DB_DECOD_*`, `DB_L2174_*`, `DB_CCU_*`, `DB_ETRAX_*`, `DB_IP_*`) bzw. aus der GUI-Seite, die den Wert anzeigt.

### Beispiel-Request

```bash
curl -s http://10.81.5.131/data.xml
```

### Beispiel-Response (Auszug)

```xml
<?xml version="1.0" encoding="utf-8" ?>
<data>
	<parameter>
		<name>DB_L2174_RX_MODE</name>
		<value><![CDATA[LMST(S)]]></value>
	</parameter>
	<parameter>
		<name>DB_L2174_FREQ1</name>
		<value><![CDATA[2.325000]]></value>
	</parameter>
	<parameter>
		<name>DB_DEMOD_PWR_LEVEL_1</name>
		<value><![CDATA[-20.7]]></value>
	</parameter>
	<parameter>
		<name>DB_L2174_ALARMS</name>
		<value><![CDATA[0000000000000000000000000000000]]></value>
	</parameter>
</data>
```

### Response-Header

```
Content-Type: text/xml
Cache-Control: max-age=1
ETag: "-832585197"
Server: lighttpd/1.4.15
```

**Wichtig**: Alle Werte stehen als String in einem `CDATA`-Block — auch Zahlen (`"2.325000"`, `"-20.7"`, `"013211"`). Bitfelder (Alarme, Selbsttest, Lizenzoptionen) kommen als einzelne `"0"`/`"1"`-Zeichenkette zurück, z. B. `DB_L2174_ALARMS` als 31-stelliger String — Bit-Bedeutung siehe [Abschnitt 5](#5-bitfelder).

---

## 2. Metadaten: `/settings.xml`

**Endpunkt**: `GET http://<L2174-IP>/settings.xml`

290 Parameter-Definitionen (~98 KB) — je Parameter aus `data.xml` (plus einige zusätzliche, rein schreibbare Aktionsparameter) liefert diese Datei Klartext-Label, Einheit und Wertebereich. Ändert sich nur bei Lizenz-/Hardware-Änderungen; ein einmaliges Laden beim Verbindungsaufbau reicht für ein Companion-Modul.

### Enum-Parameter

```xml
<parameter visible="yes">
	<name>DB_DEMOD_MOD_TYPE</name>
	<display><![CDATA[Mode]]></display>
	<option enabled="yes"><![CDATA[QPSK]]></option>
	<option enabled="yes"><![CDATA[16QAM]]></option>
	<option enabled="yes"><![CDATA[64QAM]]></option>
	<option enabled="no"><![CDATA[---]]></option>
</parameter>
```

### Numerischer Parameter

```xml
<parameter visible="yes">
	<name>DB_L2174_FREQ1</name>
	<display><![CDATA[Frequency]]></display>
	<units type="sym">GHz</units>
	<min>0.0068</min>
	<max>10.00</max>
</parameter>
```

### Bitfeld-Parameter (mehrere `<display index="N">`)

```xml
<parameter visible="yes">
	<name>DB_L2174_ALARMS</name>
	<display index="0">Clock fault </display>
	<display index="1">High Temperature</display>
	<display index="2">Demod High Temp</display>
	...
</parameter>
```

**DTD-Struktur**: `parameter → name, display*, units?, command?, min?, low?, mid?, up?, max?, option*`. Die optionalen `<low>`/`<mid>`/`<up>`-Elemente (Schwellwerte für die Touch-Slider-Darstellung) sind in der aktuellen Firmware bei keinem Parameter befüllt; `<command>` ebenfalls nicht — Schreibzugriffe laufen ausschließlich über `iframe.php` (siehe [Abschnitt 6](#6-schreibzugriff-aus-der-gui-abgeleitet--ungetestet)), nicht über einen in `settings.xml` hinterlegten Befehlsnamen.

---

## 3. Parametergruppen im Überblick

Die 290 Parameter verteilen sich auf 8 sichtbare GUI-Tabs (Top-Nav `ROUTING…UNIT`, darunter `ALARMS/DIAGNOSTICS/PRESETS/VERSIONS/LICENSES/DEMOD/DECODER`) sowie einen erheblichen Anteil, der **nur** in `data.xml`/`settings.xml` steckt, aber auf keiner Seite der Web-GUI angezeigt wird. Für ein Monitoring-Modul sind beide Kategorien gleichwertig nutzbar — die GET-Antwort unterscheidet nicht zwischen sichtbar und unsichtbar.

| Gruppe                     | GUI-Tab            | Parameter | Inhalt                                                                          |
| -------------------------- | ------------------ | --------- | ------------------------------------------------------------------------------- |
| Routing / Status           | ROUTING            | 16        | Lock-Status aller Stufen, Alarm-Bitfeld, aktueller Modus                        |
| Demodulator                | DEMODULATOR        | 10        | RF-Frequenz, Bandbreite, Modulation, FEC, Guard, Polarität                      |
| Decoder                    | DECODER            | 4         | Service-Name, Anzahl Services                                                   |
| ASI-Quelle                 | ASI SOURCE         | 4         | Routing zwischen Demod/ASI/IP/Diversity                                         |
| Diversity                  | DIVERSITY          | 4         | Diversity-Ein/Aus je Pfad, Verzögerung                                          |
| IP                         | IP                 | 5         | Ziel-IP/Port für IP-Ausgabe                                                     |
| Kamera-Fernsteuerung       | CAMERA CONTROL     | 8         | CCU-Typ, UHF-Rückkanal, L1500-Modem                                             |
| Unit / Alarme              | UNIT → ALARMS      | 3         | Status-Pin-Konfiguration                                                        |
| Unit / Diagnose            | UNIT → DIAGNOSTICS | 10        | Temperaturen, LNB-Ströme, Laufzeit, Kamera-Spannung                             |
| Unit / Presets             | UNIT → PRESETS     | 5         | Preset speichern/abrufen, Reboot, Werksreset                                    |
| Unit / Versionen           | UNIT → VERSIONS    | 11        | Firmware-/FPGA-/PCB-Versionen aller Baugruppen                                  |
| Unit / Lizenzen            | UNIT → LICENSES    | 4         | Lizenz-IDs, Lizenzcode-Eingabe                                                  |
| Unit / Demod-Lizenzen      | UNIT → DEMOD       | –         | reine Anzeige, aus `DB_DEMOD_LICENCE_OPTIONS`-Bitfeld gerendert                 |
| Unit / Decoder-Lizenzen    | UNIT → DECODER     | –         | reine Anzeige, aus `DB_DECOD_LICENCE_OPTIONS`-Bitfeld gerendert                 |
| **Demodulator, verborgen** | –                  | 57        | Pro-Kanal-Details: MER, IP-Streaming-Config, Selbsttest-Bitfeld, Lizenz-Bitfeld |
| **Decoder, verborgen**     | –                  | 109       | Audio A–D komplett, PIDs, IP-Streaming-Config, Overlay, Netzwerk                |
| **Unit, verborgen**        | –                  | 36        | Downconverter je Kanal, Verschlüsselung (AES/BISS/EBS), Routing-Modus           |

---

### 3.1 ROUTING — Status-Zusammenfassung

**Zweck**: Die Startseite der GUI; fasst den Lock-Status jeder Verarbeitungsstufe zusammen — das ist der wichtigste Satz an Feldern für ein "Ampel"-Dashboard.

| Parameter                               | Label                | Wertebereich                                  | Bedeutung                                                             |
| --------------------------------------- | -------------------- | --------------------------------------------- | --------------------------------------------------------------------- |
| `DB_DEMOD_COARSE_LOCK_1..4`             | Channel 1–4 Lock     | `No Lock`, `Locked`                           | RF-Lock je Empfangskanal (Antenne 1–4)                                |
| `DB_DEMOD_ASI_1_LOCK`                   | ASI Input Lock Value | `No Lock`, `Locked`                           | Lock des externen ASI-Eingangs                                        |
| `DB_DEMOD_IP1_LOCK`                     | IP Lock Value        | `No Lock`, `Locked`                           | Lock des IP-Eingangs                                                  |
| `DB_DEMOD_RX_MODE`                      | Mode                 | `None`, `DVB-T`, `LMST(S)`, `LMST(D)`         | aktiver Empfangsmodus                                                 |
| `DB_DECOD_VIDEO_LOCKED`                 | Video Lock           | `No Lock`, `Locked`                           | Video-Decoder-Lock                                                    |
| `DB_DECOD_AUDIO_A_LOCKED` / `_B_LOCKED` | Audio 1/2 Lock       | `No Lock`, `Locked`                           | Audio-Decoder-Lock                                                    |
| `DB_DECOD_LINE_STD`                     | Detected Video Mode  | `625`…`1080PsF30` (18 Werte)                  | erkanntes Videoformat                                                 |
| `DB_CCU_STATUS`                         | Status               | Freitext                                      | Kamera-Fernsteuerung erkannt? (`Not Detected` im Ruhezustand)         |
| `DB_L2174_VIDEO_INPUT_MODE`             | Video Input Mode     | `SD MPEG2 LD`, `HD MPEG2 LD`, `H264`, `MPEG2` | aktiver Decoder-Typ                                                   |
| `DB_L2174_PRESET_PROGRESS`              | Please wait          | `0`–`100`                                     | Fortschritt beim Preset-Laden                                         |
| `DB_L2174_WEB_TEXT`                     | Web ID               | Freitext (schreibbar)                         | frei vergebbarer Gerätename, oben in jeder GUI-Seite sichtbar         |
| `DB_L2174_ALARMS`                       | –                    | 31-Bit-Feld                                   | Sammel-Alarmstatus, siehe [Abschnitt 5.1](#51-db_l2174_alarms-31-bit) |

---

### 3.2 DEMODULATOR

**Zweck**: RF-Empfangsparameter — Frequenz, Modulation, Bandbreite, FEC.

| Parameter            | Label          | Wertebereich                      | Live-Wert (Beispiel) |
| -------------------- | -------------- | --------------------------------- | -------------------- |
| `DB_L2174_FREQ1`     | Frequency      | 0.0068–10.00 GHz                  | `2.325000`           |
| `DB_L2174_RX_MODE`   | Mode           | `DVBT`, `LMST(S)`, `LMST(D)`      | `LMST(S)`            |
| `DB_L2174_CHAN_BW`   | Bandwidth      | `3MHz`…`12MHz` (8 Stufen)         | `10MHz`              |
| `DB_DEMOD_MOD_TYPE`  | Mode           | `QPSK`, `16QAM`, `64QAM`          | `16QAM`              |
| `DB_DEMOD_FEC_RATE`  | FEC Rate       | `1/2`, `2/3`, `3/4`, `5/6`, `7/8` | `2/3`                |
| `DB_DEMOD_GUARD_INT` | Guard Interval | `1/16`, `1/8`, `Auto`             | `Auto`               |
| `DB_DEMOD_SPEC_POL`  | Polarity       | `Normal`, `Inverted`, `Auto`      | `Normal`             |
| `DB_DEMOD_TRIAX_EN`  | Triax Mode     | `Off`, `Single`, `Dual`           | `Off`                |
| `DB_DEMOD_FEC_LOCK`  | FEC Lock       | `No Lock`, `Locked`               | `Locked`             |
| `DB_DEMOD_TPS_LOCK`  | TPS Lock       | `No Lock`, `Locked`               | `Locked`             |

**Verborgene Detailfelder (nicht in der GUI, aber in `data.xml`)** — pro Empfangskanal 1–4:

| Feld-Pattern                                   | Beschreibung                      | Einheit | Wertebereich                                      |
| ---------------------------------------------- | --------------------------------- | ------- | ------------------------------------------------- |
| `DB_DEMOD_PWR_LEVEL_1..4`                      | Eingangspegel je Kanal            | dBm     | −150…10                                           |
| `DB_DEMOD_MER_1..4`                            | Modulation Error Ratio je Kanal   | dB      | −10…40                                            |
| `DB_DEMOD_ENABLE_1..4`                         | Kanal aktiv?                      | –       | `Off`, `On`                                       |
| `DB_DEMOD_PRE_BER` / `DB_DEMOD_POST_BER`       | Bitfehlerrate vor/nach FEC        | e-6     | 0…4294967295                                      |
| `DB_DEMOD_PKT_ERR_RATE`                        | Paketfehler                       | Count   | 0…4294967295                                      |
| `DB_DEMOD_PKT_DIV_SELECT`                      | aktiv genutzter Diversity-Eingang | –       | 0–8                                               |
| `DB_DEMOD_DCM_LOCK`                            | Downconverter-Modul-Lock          | –       | `No Lock`, `Locked`                               |
| `DB_DEMOD_LINK_STATUS` / `DB_DEMOD_LINK_SPEED` | Ethernet-Link des Demod-Boards    | –       | `Link Up`/`Down`, `10M…1GB [Half/Full]Duplex`     |
| `DB_DEMOD_MAC_ADDRESS`                         | MAC-Adresse Demod-Board           | –       | `00:1D:65:4C:37:D2`                               |
| `DB_DEMOD_SELFTEST_RESULTS`                    | Selbsttest-Bitfeld                | –       | siehe [5.3](#53-db_demod_selftest_results-33-bit) |
| `DB_DEMOD_LICENCE_OPTIONS`                     | Lizenz-Bitfeld                    | –       | siehe [5.4](#54-lizenz-bitfelder)                 |

Demod-seitiges IP-Streaming (Ziel für Kanal 1/2, unabhängig vom Decoder-Ausgang) liegt ebenfalls hier verborgen (`DB_DEMOD_CH1_*`, `DB_DEMOD_CH2_*`) — Struktur identisch zu den Decoder-IP-Feldern, siehe [3.3](#33-decoder).

---

### 3.3 DECODER

**Sichtbar in der GUI:**

| Parameter                    | Label                | Wertebereich | Live-Wert    |
| ---------------------------- | -------------------- | ------------ | ------------ |
| `DB_DECOD_AUTO_SERVICE`      | Auto Service Enabled | `Off`, `On`  | `On`         |
| `DB_DECOD_NUM_SERVICES`      | No. of Services      | 0–99         | `01`         |
| `DB_DECOD_SERVICE_NAME`      | Default Service Name | Freitext     | `HDwireless` |
| `DB_L2174_SERVICE_NAME_LIST` | Current Service Name | Freitext     | `Service 01` |

**Verborgene Detailfelder** — dies ist mit 109 Parametern die größte Gruppe:

_Video:_

| Feld                                                | Beschreibung                | Wertebereich                                      |
| --------------------------------------------------- | --------------------------- | ------------------------------------------------- |
| `DB_DECOD_TYPE` / `DB_DECOD_STREAM_TYPE`            | Decoder-Typ / Stream-Codec  | `Low Delay MPEG2`, `Generic MPEG2`, `H264`        |
| `DB_DECOD_PICTURE_WIDTH` / `_HEIGHT`                | Bildauflösung               | Pixel (z. B. 1920×1088)                           |
| `DB_DECOD_BIT_DEPTH`                                | Farbtiefe                   | 8–10 Bit                                          |
| `DB_DECOD_CHROMA`                                   | Chroma-Subsampling          | `4:2:0`, `4:2:2`                                  |
| `DB_DECOD_GOP`                                      | GOP-Struktur                | `I-frame`, `P-frame`, `IBP`, `IBBP`               |
| `DB_DECOD_POWER_FORMAT`                             | Default Line Standard       | 18 Videoformate (wie `DB_DECOD_LINE_STD`)         |
| `DB_DECOD_PSF_MODE`                                 | PsF-Modus                   | `Off`, `On`                                       |
| `DB_DECOD_FREEZE_ON_LOSS`                           | Verhalten bei Signalverlust | `Freeze`, `Blue`                                  |
| `DB_DECOD_VIDEO_A_TYPE` / `_B_TYPE`                 | Video-Ausgang 1/2 Format    | `SDI`, `SDI+Overlay`, `Composite`, `Comp+Overlay` |
| `DB_DECOD_OVERLAY_ENABLE` / `_TYPE` / `_BACKGROUND` | On-Screen-Overlay           | Farbe/Typ/Transparenz                             |
| `DB_DECOD_NTSC_PED`                                 | NTSC-Pedestal               | `No Pedestal`, `Pedestal`                         |
| `DB_DECOD_LINE_OFFSET`                              | Pixel-Offset                | −50000…50000                                      |
| `DB_DECOD_GEN_LOCK` / `_GEN_LOCK_ERROR`             | Frame-Lock-Modus/-Fehler    | `Off`/`SD`/`HD`, `OK`/`Fail`                      |

_Audio (Kanäle A–D, je 4 Parameter pro Kanal analog):_

| Feld-Pattern                        | Beschreibung                                 | Wertebereich                                           |
| ----------------------------------- | -------------------------------------------- | ------------------------------------------------------ |
| `DB_DECOD_AUDIO_[A-D]_STANDARD`     | Codec                                        | `Off`, `MPEG L1`, `MPEG L2`, `Linear PCM`              |
| `DB_DECOD_AUDIO_[A-D]_MODE`         | Kanalmodus                                   | `Stereo`, `Joint Stereo`, `Dual Mono`, `Straight Mono` |
| `DB_DECOD_AUDIO_[A-D]_TYPE`         | Ausgang                                      | `Analogue`, `Digital`                                  |
| `DB_DECOD_AUDIO_[A-D]_SAMPLERATE`   | Abtastrate                                   | `32.0KHz`, `44.1KHz`, `48.0KHz`                        |
| `DB_DECOD_AUDIO_[A-D]_PID`          | PID                                          | 32–8190                                                |
| `DB_DECOD_AUDIO_[C/D]_LOCKED`       | Lock (nur Kanal C/D — A/B stehen in ROUTING) | `No Lock`, `Locked`                                    |
| `DB_DECOD_AUDIO_AB_DID` / `_CD_DID` | Embedded-DID-Gruppe                          | `Off`, `Group 1`–`4`                                   |

_PIDs & Netzwerk:_

| Feld                                                                                                     | Beschreibung                                                                                                                                                                                                                        |
| -------------------------------------------------------------------------------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `DB_DECOD_VIDEO_PID`, `DB_DECOD_PCR_PID`, `DB_DECOD_DATA_PID`, `DB_DECOD_CCU_PID`, `DB_DECOD_PROGRAM_ID` | PIDs/Program-ID (32–8190 bzw. bis 2³²−1)                                                                                                                                                                                            |
| `DB_DECOD_MAC_ADDRESS`, `DB_DECOD_LINK_STATUS`, `DB_DECOD_LINK_SPEED`                                    | Ethernet-Status Decoder-Board                                                                                                                                                                                                       |
| `DB_DECOD_IP_GATEWAY`, `DB_DECOD_IP_SUBNET`, `DB_DECOD_VOIP_ADDRESS`                                     | IP-Video-Netzwerkkonfiguration                                                                                                                                                                                                      |
| `DB_DECOD_CH1_*` / `DB_DECOD_CH2_*`                                                                      | IP-Streaming je Ausgangskanal 1/2: `DEST_ADDR`, `DEST_PORT`, `SRC_PORT`, `RX_PORT`, `MULTICAST_ADDR`/`_EN`, `TS_PER_IP`, `IP_TS_ENCAP_TYPE` (`UDP only`/`RTP/UDP`), FEC-Matrix (`_FEC_D`/`_FEC_L`, Pro-MPEG-COP3-Stil), `TS_IP_TTL` |
| `DB_DECOD_IP1_LOCK`…`IP4_LOCK`, `DB_DECOD_IP1_OUTPUT_MUX`, `DB_DECOD_IP2_OUTPUT_MUX`                     | IP-Eingangs-Lock/-Routing                                                                                                                                                                                                           |
| `DB_DECOD_ASI_LOCK`, `DB_DECOD_ASI_OUTPUT_MUX`, `DB_DECOD_ASI2_OUTPUT_MUX`                               | ASI-Eingangs-Lock/-Routing                                                                                                                                                                                                          |
| `DB_DECOD_DATA_ENABLE` / `_BAUD` / `_PARITY`                                                             | serielle Datenschnittstelle                                                                                                                                                                                                         |
| `DB_DECOD_LICENCE_OPTIONS`                                                                               | Lizenz-Bitfeld, siehe [5.4](#54-lizenz-bitfelder)                                                                                                                                                                                   |
| `DB_DECOD_COMMAND`                                                                                       | `None`, `Reboot`, `Code D/load`                                                                                                                                                                                                     |
| `DB_DECOD_SET_DEFAULT`                                                                                   | `Off`, `wireless camera`, `satellite` (Werksreset-Profil)                                                                                                                                                                           |
| `DB_DECOD_BISS_E_ID`                                                                                     | BISS-Descrambling-ID (maskiert: `**************`)                                                                                                                                                                                   |

---

### 3.4 ASI SOURCE

**Zweck**: Signal-Routing zwischen Demodulator, externem ASI-Eingang, IP und Diversity-Kombinierer.

| Parameter                  | Label           | Wertebereich                                 | Live-Wert     |
| -------------------------- | --------------- | -------------------------------------------- | ------------- |
| `DB_DEMOD_ASI1_OUTPUT_MUX` | Decoder Source  | `Ext ASI`, `Demodulator`, `Diversity`, `IP`  | `Demodulator` |
| `DB_DEMOD_ASI2_OUTPUT_MUX` | ASI Out Source  | `Ext ASI`, `Demodulator`, `Diversity`, `IP`  | `Demodulator` |
| `DB_DEMOD_IP1_OUTPUT_MUX`  | IP Out Source   | `Ext ASI`, `Demodulator`, `Diversity`, `Off` | `Off`         |
| `DB_DEMOD_ASI_RATE_MBPS`   | ASI Output Rate | 2.000–50.000 Mb/s                            | `40.000`      |

---

### 3.5 DIVERSITY

**Zweck**: Ein-/Ausschalten und Timing der Diversity-Kombination über mehrere Empfangspfade.

| Parameter                  | Label              | Wertebereich  | Live-Wert |
| -------------------------- | ------------------ | ------------- | --------- |
| `DB_L2174_DEMOD_DIVERSITY` | Demod Diversity In | `Off`, `On`   | `On`      |
| `DB_L2174_ASI_DIVERSITY`   | ASI Diversity In   | `Off`, `On`   | `On`      |
| `DB_L2174_IP_DIVERSITY`    | IP Diversity In    | `Off`, `On`   | `Off`     |
| `DB_DEMOD_DIV_DELAY`       | Diversity Delay    | `Off`, `Auto` | `Auto`    |

(Verwandtes verborgenes Feld: `DB_L2174_DIVERSITY_MUX` — globaler Diversity-Schalter, `Off`/`On`.)

---

### 3.6 IP

**Zweck**: Zieladresse für den IP-Ausgang von Demod-Kanal 1 (Encapsulation/FEC-Details sind hier gebündelt, weitere IP-Kanäle liegen in den verborgenen Decoder-/Demod-Feldern, siehe 3.2/3.3).

| Parameter                       | Label                  | Wertebereich          | Live-Wert         |
| ------------------------------- | ---------------------- | --------------------- | ----------------- |
| `DB_DEMOD_CH1_DEST_ADDR`        | Destination IP Address | IPv4                  | `192.168.000.095` |
| `DB_DEMOD_CH1_DEST_PORT`        | Destination Port       | 0–9999                | `1000`            |
| `DB_DEMOD_CH1_SRC_PORT`         | Source Port            | 0–9999                | `3000`            |
| `DB_DEMOD_CH1_TS_PER_IP`        | TS per IP              | 1–7                   | `7`               |
| `DB_DEMOD_CH1_TS_IP_ENCAP_TYPE` | Encapsulation Type     | `UDP only`, `RTP/UDP` | `UDP only`        |

---

### 3.7 CAMERA CONTROL

**Zweck**: Fernsteuerung einer angeschlossenen Kamera (CCU-Rückkanal) inkl. UHF- oder L1500-Datenfunkstrecke. Auf dem hier untersuchten Gerät ist keine Kamera angeschlossen — `DB_CCU_STATUS = "Not Detected"`, die meisten Werte darum `null`.

| Parameter               | Label            | Wertebereich                                                                                       |
| ----------------------- | ---------------- | -------------------------------------------------------------------------------------------------- |
| `DB_CCU_CAMERA_TYPE`    | Type             | `Thomson`, `Sony`, `Ikegami`, `Sony Camcorder`, `Generic`, `Panasonic CamC`, `Sony DXC`, `Hitachi` |
| `DB_CCU_MODEM_LOCATION` | Modem Location   | `Internal`, `External`                                                                             |
| `DB_CCU_UHF_FREQ`       | UHF Freq         | 410000–490000 kHz                                                                                  |
| `DB_CCU_UHF_POWER`      | UHF Power        | 0.1–2 W                                                                                            |
| `DB_CCU_OPTION`         | Option           | gerätespezifisch                                                                                   |
| `DB_L2174_RF_MOD`       | L1500 Modulation | `QPSK`, `16QAM`                                                                                    |
| `DB_L2174_RF_POWER`     | L1500 RF Power   | `10mW`, `50mW`, `100mW`, `250mW`                                                                   |
| `DB_DECOD_CCU_BAUD`     | RTN Baud         | `1200`…`115200` (8 Stufen)                                                                         |

---

### 3.8 UNIT

Der Reiter „UNIT“ fasst sechs Unterseiten zusammen.

#### 3.8.1 ALARMS

| Parameter                   | Label            | Wertebereich      | Live-Wert                        |
| --------------------------- | ---------------- | ----------------- | -------------------------------- |
| `DB_STATUS_PIN_MODE`        | Status Pin Mode  | `Alarm`, `Manual` | `Alarm`                          |
| `DB_STATUS_PIN_ALARM_LEVEL` | Alarm State      | `High`, `Low`     | `High`                           |
| `DB_STATUS_PIN_STATE`       | Status Pin State | `High`, `Low`     | (nur im `Manual`-Modus relevant) |

Der eigentliche Alarmstatus des Geräts steht nicht hier, sondern im Bitfeld `DB_L2174_ALARMS` auf der ROUTING-Seite ([5.1](#51-db_l2174_alarms-31-bit)) — diese Unterseite konfiguriert nur, wie der physische Alarm-Ausgangspin sich verhält.

#### 3.8.2 DIAGNOSTICS

| Parameter                | Label               | Einheit | Wertebereich                   | Live-Wert                   |
| ------------------------ | ------------------- | ------- | ------------------------------ | --------------------------- |
| `DB_ETRAX_PCB_TEMP`      | Unit Temperature    | °C      | −55…150                        | `40.0`                      |
| `DB_DEMOD_FPGA_TEMP`     | Demod Temperature   | °C      | 0…999                          | `73`                        |
| `DB_DECOD_FPGA_TEMP`     | Decoder Temperature | °C      | 0…999                          | `77`                        |
| `DB_L2174_RUN_HOURS`     | Run Hours           | h       | 0…999999                       | `013211`                    |
| `DB_L2174_CAM_BATT_VOLT` | Camera Volts        | V       | 0.0…25.5                       | `15.1`                      |
| `DB_DEMOD_CURRENT_1..4`  | LNB 1–4 Current     | mA      | 0…800                          | `044`/`066`/`050`/`045`     |
| `DB_L2174_HW_OPTION_LCD` | Display Hardware    | –       | `MK 1 (green)`, `MK 2 (white)` | `MK 1 (green)` (schreibbar) |

Diese Seite ist der beste Einstieg für ein Temperatur-/Health-Monitoring — sie deckt sich mit der Idee dieses Projekts für RXD4/Nano HEVC TX.

#### 3.8.3 PRESETS

| Parameter                | Label            | Wertebereich | Hinweis                                                          |
| ------------------------ | ---------------- | ------------ | ---------------------------------------------------------------- |
| `DB_L2174_PRESET_NUM`    | Preset Number    | 1–16         | wählt den Preset-Slot für Store/Recall                           |
| `DB_L2174_PRESET_RECALL` | Recall           | `No`, `Yes`  | **löst beim Setzen auf `Yes` sofort das Laden des Presets aus**  |
| `DB_L2174_PRESET_STORE`  | Store            | `No`, `Yes`  | **überschreibt beim Setzen auf `Yes` den gewählten Preset-Slot** |
| `DB_RESTORE_DEFAULTS`    | Restore Defaults | `No`, `Yes`  | Werksreset                                                       |
| `DB_L2174_REBOOT`        | Reboot Unit      | `No`, `Yes`  | Geräteneustart                                                   |

Alle fünf Parameter sind in der GUI schreibbar; `PRESET_STORE`, `PRESET_RECALL` und `REBOOT` verlangen in `common/custom.js` (`check_for_confirmation()`) zusätzlich eine JS-`confirm()`-Bestätigung, bevor die Anfrage abgeschickt wird — ein deutliches Signal, dass diese Aktionen als gefährlich eingestuft sind. **Für dieses Projekt ausschließlich zur Kenntnisnahme dokumentiert, nicht zum Aufruf.**

#### 3.8.4 VERSIONS

| Parameter                                                     | Label                           | Live-Wert             |
| ------------------------------------------------------------- | ------------------------------- | --------------------- |
| `DB_L2174_BUILD_VERSION`                                      | Unit Build                      | `V1039`               |
| `DB_L2174_SW_VERSION`                                         | Unit Sw Version                 | `3.04`                |
| `DB_L2174_KERN_VERSION`                                       | Kernel Version                  | `1.05`                |
| `DB_L2174_PROC_TYPE`                                          | Control Processor               | `Etrax`               |
| `DB_L2174_SERIAL_NUM`                                         | Unit Serial No                  | `0314525`             |
| `DB_DEMOD_DISPLAY_BUILD` / `DB_DEMOD_FPGA` / `DB_DEMOD_PCB`   | Demodulator SW/FPGA/PCB-Version | `0.21` / `1.63` / `7` |
| `DB_DECODER_DISPLAY_BUILD` / `DB_DECOD_FPGA` / `DB_DECOD_PCB` | Decoder SW/FPGA/PCB-Version     | `1.31` / `1.15` / `4` |

#### 3.8.5 LICENSES

| Parameter               | Label          | Live-Wert                |
| ----------------------- | -------------- | ------------------------ |
| `DB_ETRAX_SOURCE_ID`    | Control ID     | `0170a449`               |
| `DB_DEMOD_SOURCE_ID`    | Demodulator ID | `02fc37d2`               |
| `DB_DECOD_SOURCE_ID`    | Decoder ID     | `03d961d0`               |
| `DB_FULL_LICENCE_ENTRY` | Licence Code   | Eingabefeld (schreibbar) |

Zugehörig, aber außerhalb dieser Seite in `data.xml`: `DB_DISPLAY_DEMOD_LICENCE` / `DB_DISPLAY_DECOD_LICENCE` — die vollständigen, bereits eingetragenen Lizenzcodes im Klartext.

#### 3.8.6 DEMOD- und DECODER-Lizenzseiten

Reine Anzeigeseiten ohne eigene Parameter — sie rendern lediglich die Bit-für-Bit-Bedeutung von `DB_DEMOD_LICENCE_OPTIONS` bzw. `DB_DECOD_LICENCE_OPTIONS` als Freigeschaltet/Gesperrt-Liste, siehe [5.4](#54-lizenz-bitfelder).

---

## 4. Verborgene Unit-Parameter (nur `data.xml`)

36 Parameter ohne eigene GUI-Seite, u. a.:

| Feld                                                                                   | Beschreibung                                     | Wertebereich                                               |
| -------------------------------------------------------------------------------------- | ------------------------------------------------ | ---------------------------------------------------------- |
| `DB_L2174_DOWN_CONVERTER_1..4`                                                         | Downconverter-Typ je Empfangskanal               | 29 Modelltypen (`L3010Lo` … `L3025-6368`, `Other`, `None`) |
| `DB_L2174_LNB_PWR_1..4`                                                                | Downconverter-Speisespannung je Kanal            | `Off`, `On`                                                |
| `DB_L2174_OTHER_LO_1..4`                                                               | LO-Frequenz bei „Other“-Downconverter            | 0.0068–10.00 GHz                                           |
| `DB_L2174_ROUTING_MODE`                                                                | Routing Mode                                     | `Basic`, `Advanced`                                        |
| `DB_L2174_OUTPUT_ALL_MUX` / `DB_L2174_SET_ALL`                                         | Alle Ausgangskanäle gleichzeitig routen          | `Ext ASI`/`Demodulator`/`IP`/`Diversity`, `No`/`Yes`       |
| `DB_L2174_VIDEO_FORMAT`                                                                | Video Format (Konfigurationsseite des Decoders)  | 18 Formate + `------`                                      |
| `DB_L2174_MPEG1_AUDIO_[A-D]_BITRATE` / `MPEG2_AUDIO_[A-D]_BITRATE`                     | Audio-Zielbitrate je Standard/Kanal              | 14 Stufen, 32–448 kbit/s                                   |
| `DB_L2174_ALLOW_WEB_UPGRADE`                                                           | Firmware-Update über Web erlaubt?                | `No`, `Yes`                                                |
| `DB_L2174_NEWSLITE_UNIT`                                                               | NewsLite-Lizenzvariante                          | `No`, `Yes`                                                |
| `DB_L2174_AES_KEY01TO64` … `_KEY193TO256`, `DB_L2174_SET_KEY`                          | AES-256-Schlüssel (4×64 Bit) für Verschlüsselung | Hex / `No`,`Yes`                                           |
| `DB_L2174_BISS_1_KEY`, `DB_L2174_BISS_E_ID`, `DB_L2174_BISS_E_KEY`, `DB_L2174_EBS_KEY` | BISS-/EBS-Descrambling-Schlüssel                 | Hex                                                        |

Verschlüsselungsschlüssel werden nicht mit ausgelesen (Feld liefert `null`, wenn kein Schlüssel gesetzt ist) und sind für ein Monitoring-Modul ohnehin irrelevant.

---

## 5. Bitfelder

Mehrere Parameter sind keine Einzelwerte, sondern String-kodierte Bitfelder — jedes Zeichen des Werts entspricht einem `<display index="N">` in `settings.xml`. Für ein Companion-Modul lohnt es sich, diese vier Felder einmalig zu dekodieren und als Einzel-Feedbacks anzubieten.

### 5.1 `DB_L2174_ALARMS` (31 Bit)

Alle `0` bedeutet störungsfrei. Auf dem untersuchten Gerät aktuell durchgängig `0`.

| Bit | Bedeutung             | Bit | Bedeutung             |
| --- | --------------------- | --- | --------------------- |
| 0   | Clock fault           | 16  | ASI not Locked        |
| 1   | High Temperature      | 17  | Video not Locked      |
| 2   | Demod High Temp       | 18  | Audio 1 not Locked    |
| 3   | Decoder High Temp     | 19  | Audio 2 not Locked    |
| 4   | Demod Self Test Fault | 20  | Frame not Locked      |
| 5   | Decoder Comms Fault   | 21  | IP Link Error         |
| 6   | Synth not Locked      | 22  | IP not Locked         |
| 7   | LPF not Tuned         | 23  | Test fault            |
| 8   | ADC Clock not Locked  | 24  | Dummy                 |
| 9   | ASI Clock not Locked  | 25  | Fan1 fault            |
| 10  | LNB Fault             | 26  | Fan2 fault            |
| 11  | Invalid Frequency     | 27  | Lic format mismatch   |
| 12  | Demod Freq Error      | 28  | Lic ID checksum error |
| 13  | RF not Locked         | 29  | Lic unit mismatch     |
| 14  | TPS not Locked        | 30  | Lic type mismatch     |
| 15  | FEC not Locked        |     |                       |

### 5.2 `DB_DEMOD_LICENCE_OPTIONS` (40 Bit)

Auf dem Testgerät freigeschaltet: DVB-T, LMS-T 10/20MHz, 4-Input-Demod, Packet Diversity, IP Input.

| Bit | Feature           | Bit   | Feature          |
| --- | ----------------- | ----- | ---------------- |
| 0   | DVB-T             | 18    | Packet Diversity |
| 1   | LMS-T 10MHz       | 19    | Dual Diversity   |
| 2   | LMS-T 20MHz       | 20    | IP output        |
| 3   | LMS-T Narrow Band | 21    | IP input         |
| 4   | SCM Demod         | 9     | BISS             |
| 5   | 4 Input Demod     | 10    | AES 128          |
| 8   | EBS               | 11    | AES 256          |
| 16  | Deinterleaving    | 12/13 | BCrypt 128/256   |
| 17  | Remux             |       |                  |

_(nicht belegte Bits sind mit „Licence Unused“ reserviert)_

### 5.3 `DB_DEMOD_SELFTEST_RESULTS` (33 Bit)

Bit 0 = Gesamtergebnis „Self Tests Passed“; Bits 1–21 einzelne Fehlerquellen (Supply, LNB, ADC-Clock, ASI-Clock, ADC 1–4, LO 1–4 Lock, LPF 1–4 Tune, RF 1–4 Level, DCM-Clock). Auf dem Testgerät: `100000000000000000000000000000000` → alle Tests bestanden.

### 5.4 Lizenz-Bitfelder

Neben dem Demodulator-Bitfeld (5.2) gibt es `DB_DECOD_LICENCE_OPTIONS` (40 Bit) für den Decoder. Auf dem Testgerät u. a. freigeschaltet: SD/HD MPEG-2 (Low Delay + Compliant), MPEG-2 4:2:2, H.264 Main/High/4:2:2/10-Bit, SD SDI Out, Dolby-E-Passthrough, Digital Audio, IP Input, Packet Diversity, Status Overlay. Gesperrt: HD MPEG-2 Compliant, EBS, BISS, AES/BCrypt-Verschlüsselung, IP Output, Remux, Dual Diversity, Audio-Kanäle C/D.

Diese beiden Felder entsprechen 1:1 den GUI-Seiten „DEMOD“ und „DECODER“ unter dem UNIT-Tab (3.8.6) — wer die Bit-Tabellen aus `settings.xml` einmal einliest, braucht die Seiten selbst nicht mehr aufzurufen.

---

## 6. Schreibzugriff (aus der GUI abgeleitet — **ungetestet**)

> Alles in diesem Abschnitt wurde ausschließlich aus dem JavaScript der Web-GUI (`common/webgui.js`, `common/custom.js`) rekonstruiert. **Es wurde kein einziger Schreibzugriff gegen das Testgerät ausgeführt** — das Gerät ist im Produktiveinsatz. Vor einer echten Nutzung: an einem Ersatzgerät verifizieren.

Jedes Set-Formular in der GUI ruft eine von mehreren JS-Funktionen auf, die alle auf dasselbe Muster hinauslaufen: ein `GET` auf `iframe.php`, dessen Antwort in einem unsichtbaren Frame (`setting_frame`) landet und die Seite dadurch nicht neu lädt.

```
GET /common/iframe.php?param=<PARAMETER_NAME>&value=<URL-ENCODED-WERT>
```

Beispiel (Combo-Box „Mode“ im Demodulator-Tab, **nicht ausgeführt**):

```bash
# NICHT AUSFÜHREN — nur zur Dokumentation des Patterns
# curl -s "http://10.81.5.131/common/iframe.php?param=DB_DEMOD_MOD_TYPE&value=64QAM"
```

Zwei clientseitige Schutzmechanismen in `custom.js`, die ein eigenes Schreib-Tool nachbilden müsste:

- **`check_for_invalid_setting_attempt(param)`** — blockiert Änderungen an Frequenz/Modus/Bandbreite/Guard-Interval, solange ein `DB_DVE_CARRIER`-Parameter auf `On` steht. Dieser Parameter taucht in der `data.xml` des L2174 nicht auf — die Prüfung ist offenbar aus einer anderen Vislink-Plattform (mit TX-Carrier) übernommen und für den L2174 wirkungslos. Für ein eigenes Tool heißt das: **diese serverseitige Absicherung existiert hier nicht**, ein Schreib-Client müsste sie selbst nachbilden oder zumindest den Lock-Status vor einer Frequenz-/Modusänderung prüfen.
- **`check_for_confirmation(param, val)`** — verlangt eine JS-`confirm()`-Bestätigung, wenn `DB_L2174_PRESET_STORE`, `DB_L2174_PRESET_RECALL` oder `DB_L2174_REBOOT` auf `"Yes"` gesetzt werden. Serverseitig gibt es dafür keine Bestätigung — der `GET`-Request allein löst die Aktion aus.

Die 38 in der GUI als schreibbar identifizierten Parameter (Formularfelder mit `send_form`/`send_form_combo`) sind über die gesamte obige Tabellenübersicht verteilt; besonders zu beachten sind die in 3.8.3 gelisteten Presets/Reboot/Restore-Defaults-Parameter, da sie den laufenden Betrieb sofort unterbrechen können.

---

## 7. Daten-Polling-Strategie

| Endpunkt        | Intervall                                              | Begründung                                                                   |
| --------------- | ------------------------------------------------------ | ---------------------------------------------------------------------------- |
| `/data.xml`     | 1–2 Sek.                                               | deckt praktisch alle Telemetrie ab; die native GUI selbst pollt alle 1000 ms |
| `/settings.xml` | einmalig beim Verbindungsaufbau, danach nur bei Bedarf | ändert sich nur bei Lizenz-/Hardwareänderung                                 |

### Effizienz-Tipps

1. **Ein Poll genügt**: Anders als bei RXD4 (mehrere Module) oder Nano HEVC TX (Status + Config getrennt) deckt hier ein einziger `GET /data.xml` alle 248 Live-Werte ab — kein Grund für unterschiedliche Intervalle pro Funktionsbereich.
2. **`settings.xml` cachen**: 98 KB, ändert sich praktisch nie im laufenden Betrieb — einmal parsen, Label/Einheit/Wertebereich lokal vorhalten.
3. **`Cache-Control: max-age=1`** beachten — der Server selbst signalisiert, dass eine Poll-Rate über 1 Hz sinnlos ist.
4. **Bitfelder einmalig dekodieren**: Bit-Layout aus `settings.xml` ableiten und pro Feld benannte Boolesche Werte erzeugen (`ALARM_HIGH_TEMP`, `SELFTEST_LNB_FAIL`, …) statt den Rohstring live zu parsen.

---

## 8. Häufige Anwendungsfälle

### Use Case 1: Health-/Status-Dashboard

Ein Poll von `/data.xml` alle 1–2 Sekunden liefert:

- Lock-Kette (`DB_DEMOD_COARSE_LOCK_1..4` → `DB_DECOD_VIDEO_LOCKED`)
- Signalqualität (`DB_DEMOD_PWR_LEVEL_1..4`, `DB_DEMOD_MER_1..4`, `DB_DEMOD_PRE_BER`/`POST_BER`)
- Temperaturen (`DB_ETRAX_PCB_TEMP`, `DB_DEMOD_FPGA_TEMP`, `DB_DECOD_FPGA_TEMP`)
- Sammel-Alarm (`DB_L2174_ALARMS`, bitweise dekodiert)

### Use Case 2: Companion-Modul-Feedbacks/Variablen

Direkte 1:1-Abbildung: jeder Parameter aus `data.xml` → eine Companion-Variable; jedes Bit aus `DB_L2174_ALARMS`/`DB_DEMOD_SELFTEST_RESULTS` → ein Feedback. Die Labels aus `settings.xml` lassen sich automatisiert als Variablen-Beschreibung übernehmen, statt sie im Modul hart zu codieren.

### Use Case 3: Multi-Antennen-Signalvergleich

```bash
curl -s http://10.81.5.131/data.xml
# Felder DB_DEMOD_PWR_LEVEL_1..4 und DB_DEMOD_MER_1..4 extrahieren
# → Pegel/MER je der 4 Empfangsantennen für Diversity-Auswertung
```

### Use Case 4: Presets/Reboot fernsteuern

Erst nach Verifikation an einem Testgerät sinnvoll — Muster wäre `GET iframe.php?param=DB_L2174_PRESET_RECALL&value=Yes` nach vorherigem Setzen von `DB_L2174_PRESET_NUM`. Siehe Warnhinweis in Abschnitt 6.

---

## 9. Bekannte Limitierungen & Edge Cases

### Keine Authentifizierung

Weder `data.xml`/`settings.xml` noch `iframe.php` verlangen Zugangsdaten — Zugriff ist rein netzwerkbasiert abgesichert. Für ein Monitoring-Tool unproblematisch, für Schreibzugriffe ein zusätzlicher Grund zur Vorsicht.

### Alles ist String

`data.xml` kennt keine Datentypen — Zahlen, Bitfelder und Freitext kommen alle als String in einem `CDATA`-Block. Führende Nullen bleiben erhalten (`DB_L2174_RUN_HOURS = "013211"`, `DB_DEMOD_CURRENT_1 = "044"`) — beim Parsen nicht versehentlich als Oktalzahl interpretieren.

### `null`/leere Werte

Nicht angeschlossene oder lizenzierte Hardware liefert leere `<value/>`-Elemente (im JSON-Merge dieser Doku als `None` dargestellt) statt eines Fehlers, z. B. alle `DB_CCU_*`-Felder ohne angeschlossene Kamera, oder `DB_DECOD_AUDIO_A_MODE` ohne aktives Audiosignal.

### Bitfeld-Länge ist nicht fix dokumentiert

`DB_L2174_ALARMS` liefert einen 31- bis 33-stelligen String, `DB_DEMOD_SELFTEST_RESULTS` 33–35 Stellen, `DB_DEMOD_LICENCE_OPTIONS`/`DB_DECOD_LICENCE_OPTIONS` 40–42 Stellen — die Firmware hängt teils zusätzliche `0`-Füllzeichen an, ohne dass `settings.xml` dafür ein `<display>` definiert. Robuste Parser sollten per Bit-Index aus `settings.xml` zugreifen und überzählige Zeichen am Stringende ignorieren, statt eine feste Länge anzunehmen.

### Generischer JS-Code aus anderen Plattformen

`common/custom.js` enthält Prüfungen für Parameter (`DB_DVE_CARRIER`, `DB_DEMOD_FREQ1`, `DB_DEMOD_OFDM_BANDWIDTH`), die auf dem L2174 gar nicht existieren (er nutzt `DB_L2174_FREQ1` statt `DB_DEMOD_FREQ1`). Die Web-GUI ist offensichtlich aus einer gemeinsamen Vislink-Codebasis für mehrere Produktlinien abgeleitet — Doku und eigene Tools sollten sich strikt an das tatsächliche `data.xml`/`settings.xml` des L2174 halten, nicht an das, was im JS an ungenutztem Code mitgeschleppt wird.

### Kein Push, kein WebSocket

Wie bei RXD4 und Nano HEVC TX: reines Request/Response, keine Server-seitigen Events — Monitoring nur per Polling möglich.

---

## 10. Vergleich: RXD4 / Nano HEVC TX / Lynx L2174

| Aspekt                      | Sapphire RXD4                             | Nano HEVC TX                                 | **Lynx L2174**                                                                                       |
| --------------------------- | ----------------------------------------- | -------------------------------------------- | ---------------------------------------------------------------------------------------------------- |
| **API-Stil**                | REST, modulbasiert (MASH)                 | JSON-Statusdatei + CGI                       | **Statische XML-Dateien + Query-String-CGI**                                                         |
| **Protokoll**               | HTTPS (self-signed)                       | HTTP                                         | **HTTP**                                                                                             |
| **Live-Telemetrie**         | `/api/status/<modul>` (mehrere Endpunkte) | `/sts/UnitStatus.json` (eine Datei)          | **`/data.xml`** (eine Datei, 248 Werte)                                                              |
| **Konfiguration lesen**     | `/api/config/<modul>`                     | `/config/*.json`                             | **`/settings.xml`** (Labels + Bereiche, kein Live-Wert)                                              |
| **Datenformat**             | JSON, verschachtelt, typisiert            | JSON, meist String-typisiert                 | **XML, flach, ausschließlich String/CDATA**                                                          |
| **Schreiben**               | `POST /api/config/*` (JSON-Body)          | `POST /*.cgi` (Form-encoded)                 | **`GET /common/iframe.php?param=&value=`**                                                           |
| **Authentifizierung**       | optional (API-Key/Basic-Auth)             | optional (Basic-Auth bei gesetztem Passwort) | **keine**                                                                                            |
| **Bitfelder**               | nicht verwendet                           | teils (`VideoLock` als Bitmaske)             | **umfangreich** (Alarme, Selbsttest, 2× Lizenzoptionen), Bedeutung nur über `settings.xml`           |
| **Selbstbeschreibung**      | `/api/mash/status-schema/<modul>`         | keine                                        | **`settings.xml`** liefert Label/Einheit/Bereich für jeden Parameter                                 |
| **Polling-Empfehlung**      | 2–5 Sek. je Modul                         | 2–5 Sek.                                     | **1–2 Sek.**, ein einziger Endpunkt                                                                  |
| **Reifegrad der Plattform** | modern, modular, aktiv weiterentwickelt   | mittel, gerätespezifisch                     | **ältere Plattform** (Etrax-Prozessor, `lighttpd 1.4.15`), aber dadurch besonders einfach anzubinden |

Bemerkenswert: **L2174 ist die einzige der drei Plattformen mit eingebauter Selbstbeschreibung** (`settings.xml`) — ein Companion-Modul könnte die Variablenliste inklusive Klartext-Namen und Wertebereichen zu großen Teilen automatisiert aus dem Gerät selbst ableiten, statt sie hart zu codieren.

---

## 11. Referenzen

- Hersteller: Vislink (ehemals Advent, davor teils IMT) — L2174 ist Teil der „Lynx“-Empfängerfamilie.
- Herstellerbezeichnung im Web-UI: `<title>L2174</title>`, `<h1>L2174</h1>`, `<h2>LYNX RECEIVER</h2>`.
- Alle Angaben in diesem Dokument wurden **read-only** per `GET` gegen ein produktives Gerät (`10.81.5.131`) ermittelt: `/data.xml`, `/settings.xml`, `/common/webgui.js`, `/common/custom.js`, sowie alle 14 `/common/<seite>.html`-Dateien der GUI-Navigation.
- Verwandte Recherche zu zwei weiteren Domo/Vislink-Plattformen (`SAPPHIRE_RXD4_API.md`, `NANO_HEVC_TX_API.md`) liegt im Schwesterprojekt [`domo-temperature-monitor`](https://github.com/unbindthefog/domo-temperature-monitor)/`apidoc/` — der Vergleichsabschnitt oben fasst die Unterschiede zusammen.

---

**Dokument-Version**: 1.0
**Erstellungsdatum**: 2026-09-04
**Gerät**: Vislink Lynx L2174 (IP: 10.81.5.131, Web-ID „K7“)
**Firmware**: Unit Build V1039, Unit Sw Version 3.04, Kernel 1.05
**Status**: Read-only untersucht & dokumentiert — **kein Schreibzugriff getestet** (Produktivgerät)
