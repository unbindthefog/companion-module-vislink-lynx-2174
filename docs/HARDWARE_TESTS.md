# Hardware-Tests

Was am Gerät noch nachzuweisen ist, womit, und in welcher Reihenfolge. Die
Ergebnisse kommen in dieses Dokument zurück — dieselbe Stelle, an der auch die
Einschwingzeiten in `LYNX_L2174_API.md` §6 stehen.

## Zuerst: an welchem Gerät

Das Modul schreibt inzwischen 35 Parameter. Vor dem ersten Tastendruck gehört
geklärt, **welcher** Receiver vor einem steht:

| Gerät                                                           | Was erlaubt ist                |
| --------------------------------------------------------------- | ------------------------------ |
| Laborgerät, nicht auf Sendung                                   | alles aus diesem Dokument      |
| Ersatzgerät im Rack, nicht zugeschaltet                         | alles außer Abschnitt 5        |
| Produktivgerät auf Sendung (K7 `10.81.5.131`, K6 `10.81.5.132`) | **nichts** aus diesem Dokument |

Der Grund für die letzte Zeile ist nicht Vorsicht um ihrer selbst willen:
`iframe.php` kennt keine Authentifizierung und keine Bestätigung. Ein Write ist
sofort wirksam, und die Hälfte der Werte hier unterbricht den Empfang.

Falls doch gegen ein Gerät im Rack getestet wird: vorher den Zustand sichern,
denn ohne ihn ist hinterher nicht entscheidbar, was der Test verändert hat und
was ohnehin so war.

```bash
curl -s http://<ip>/data.xml -o vorher.xml
# ... Test ...
curl -s http://<ip>/data.xml -o nachher.xml
diff <(grep -o '<name>.*</value>' vorher.xml) <(grep -o '<name>.*</value>' nachher.xml)
```

## Was schon nachgewiesen ist

Alles am Laborgerät `10.81.5.149` („Rx Relais", V1039), ohne Antenne und ohne
Signal, am 20.10.2026.

| Action                | Nachweis                                                                       |
| --------------------- | ------------------------------------------------------------------------------ |
| `set_frequency`       | gesetzt und zurückgelesen, Einschwingzeit 617–874 ms                           |
| `set_bandwidth`       | gesetzt und zurückgelesen, 335–2982 ms (der langsamste Parameter)              |
| `set_rx_mode`         | gesetzt und zurückgelesen                                                      |
| `set_decoder_source`  | gesetzt und zurückgelesen                                                      |
| `set_demod_diversity` | gesetzt und zurückgelesen                                                      |
| `set_web_id`          | gesetzt und zurückgelesen, ~850 ms                                             |
| `recall_preset`       | Slot 1 geladen, 30 Parameter geändert, Trigger fiel von selbst auf `No` zurück |
| `set_freeze_on_loss`  | `Blue` → `Freeze` → `Blue`                                                     |
| `set_lnb_power`       | Kanal 1 `On` → `Off`, **ohne Last am Koax** — siehe Abschnitt 1                |

## Sweep vom 22.10.2026: jeder Wert einmal geschrieben

Alle Auswahl-Parameter einmal durch ihre Werte gefahren, jeweils geschrieben und
zurückgelesen, danach auf den Ausgangswert zurück. Gerät anschließend
byteweise wie vorher.

**Angenommen wurde ausnahmslos jeder Wert**, den das Modul anbietet — Guard
Interval (5), Polarität (3), Kanal-Enable (4×2), ASI- und IP-Ausgangsquelle
(je 4), ASI-Diversity, Diversity-Delay, Video-Input-Modus (4), Genlock (3),
beide Ausgangsformate (je 4, **einschließlich Composite auf Ausgang 1**),
Overlay-Typ, -Hintergrund (11) und -Farbe, Status-Pin-Modus und -Alarmpegel.
Die Wertelisten in `src/controls.ts` stimmen damit gegen das Gerät.

Zwei Dinge kamen dabei heraus, die vorher falsch im Code standen — beide sind
behoben und in `LYNX_L2174_API.md` festgehalten:

- `data.xml` führt nicht immer dieselben Parameter. `DB_STATUS_PIN_STATE` und
  `DB_STATUS_PIN_ALARM_LEVEL` tauschen mit `DB_STATUS_PIN_MODE` die Plätze.
- `DB_L2174_VIDEO_INPUT_MODE` verträgt keine Folge, auch keine langsame: drei
  Werte mit 5 s Abstand, und das Gerät bleibt beim ersten; mit 8 s beim
  mittleren. Der letzte Schreibvorgang gewinnt nicht.

**Was der Sweep nicht beantwortet**, und wofür die Abschnitte unten da sind:
ob ein angenommener Wert auch wirkt. Dafür braucht es Signal, Downconverter,
Monitor oder Referenz.

## 1. Downconverter-Speisung unter Last

Das Einzige, was am Tischgerät nur halb beantwortet werden konnte. Der Write
wird angenommen, aber ohne etwas am Koax sagt das Gerät nichts darüber, ob
wirklich Spannung anliegt:

- `DB_DEMOD_CURRENT_1` blieb bei `017` — kein Strom, keine Last
- `DB_L2174_ALARMS` Bit 10 (`LNB Fault`) blieb `0`

Offen ist damit, ob die beiden Werte **mit** Downconverter brauchbar sind:

| Schritt                                    | Erwartung               | Notieren                     |
| ------------------------------------------ | ----------------------- | ---------------------------- |
| Downconverter an Eingang 1, Speisung `Off` | Strom nahe dem Leerwert | `DB_DEMOD_CURRENT_1`         |
| Speisung auf `On`                          | Strom steigt messbar    | Wert und wie lange es dauert |
| Speisung auf `Off`                         | Strom fällt zurück      | Wert                         |

Wenn der Strom dabei einen brauchbaren Sprung macht, ist das die Grundlage für
ein Feedback „Speisung läuft wirklich" statt nur „Speisung ist eingeschaltet" —
und für eine Ampel, die einen Kurzschluss im Koax sichtbar macht, bevor jemand
ihn sucht.

**Nicht** absichtlich kurzschließen, um `LNB Fault` zu provozieren. Ob der Alarm
dabei anspricht, lässt sich auch beobachten, falls es ohnehin passiert.

## 2. Was echtes Signal braucht

Ungetestet, und am Tischgerät nicht sinnvoll prüfbar, weil ohne Träger kein
Unterschied sichtbar wird.

| Action                  | Werte                            | Worauf achten                                                                                                                                                  |
| ----------------------- | -------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `set_guard_interval`    | `1/32` `1/16` `1/8` `1/4` `Auto` | Hält der Lock? Wie lange dauert die Neuakquise gegenüber `Auto`?                                                                                               |
| `set_spectral_polarity` | `Normal` `Inverted` `Auto`       | Bricht `Inverted` den Lock sofort ab? Fängt `Auto` das auf?                                                                                                    |
| `set_channel_enable`    | je Kanal `Off`/`On`              | Fällt der MER des Gesamtsignals, wenn ein beitragender Kanal rausgeht? Reagiert `DB_DEMOD_PKT_DIV_SELECT`?                                                     |
| `set_asi_diversity`     | `Off`/`On`                       | nur mit ASI-Quelle am Eingang sinnvoll                                                                                                                         |
| `set_diversity_delay`   | `Off`/`Auto`                     | Unterschied überhaupt messbar, oder nur bei verschiedenen Laufzeiten?                                                                                          |
| `set_bandwidth`         | im jeweiligen Modus              | **Bestätigen, dass das Gerät im LMS-T-Modus nur 6/7/8 MHz annimmt** — die Einschränkung stammt aus `settings.xml` und ist nie gegen einen Write geprüft worden |

Der letzte Punkt ist der wichtigste in dieser Tabelle. Die Wertelisten im Modul
sind die vollen Mengen, und die Annahme dahinter lautet: was das Gerät gerade
nicht will, verwirft es, und das Zurücklesen meldet es. Diese Annahme ist noch
nie gegen einen tatsächlich abgelehnten Wert getestet worden. Ein Test dafür
kostet nichts: im Modus LMST(S) `10MHz` setzen und schauen, ob im Companion-Log
die Warnung „still does not read …" erscheint.

## 3. Was einen Decoder-Ausgang braucht

Monitor an Ausgang 1 und 2, am besten mit Bild.

| Action                   | Werte                                          | Worauf achten                                               |
| ------------------------ | ---------------------------------------------- | ----------------------------------------------------------- |
| `set_video_input_mode`   | `SD MPEG2 LD` `HD MPEG2 LD` `H264` `MPEG2`     | Bei falschem Codec: schwarz, oder Standbild, oder Blue?     |
| `set_video_output_1`     | `SDI` `SDI+Overlay` `Composite` `Comp+Overlay` | Overlay erscheint/verschwindet; Composite siehe Abschnitt 5 |
| `set_video_output_2`     | dieselben vier                                 | Gegenprobe zu Ausgang 1                                     |
| `set_overlay_type`       | `Basic` `Service`                              | Was steht jeweils drin                                      |
| `set_overlay_background` | `Off` … `100`                                  | Sichtbarer Unterschied zwischen den Stufen                  |
| `set_overlay_colour`     | `White` `Green`                                | —                                                           |

## 4. Was eine Referenz braucht

| Action        | Werte           | Worauf achten                                                                                     |
| ------------- | --------------- | ------------------------------------------------------------------------------------------------- |
| `set_genlock` | `Off` `SD` `HD` | Geht `DB_DECOD_GEN_LOCK_ERROR` von `OK` auf `Fail`, wenn keine oder die falsche Referenz anliegt? |

Wenn `genlock_error` zuverlässig reagiert, ist das ein Feedback wert — Frame
Lock ist genau die Art Fehler, die man im Bild erst bemerkt, wenn es zu spät
ist.

## 5. Offen seit dem 22.10.: angenommen heißt nicht wirksam

Das Gerät nimmt `Composite` und `Comp+Overlay` für **Ausgang 1** an und meldet
sie zurück, obwohl `settings.xml` sie dort als `enabled="no"` führt. Ob ein Bild
am Stecker ankommt, sagt das Zurücklesen nicht.

| Schritt                                                    | Erwartung        |
| ---------------------------------------------------------- | ---------------- |
| Monitor an Ausgang 1, `set_video_output_1` auf `Composite` | Bild oder nicht? |
| dasselbe an Ausgang 2 (dort `enabled="yes"`)               | als Gegenprobe   |

Fällt Ausgang 1 aus, gehört die Werteliste in `src/controls.ts` wieder auf zwei
Werte gekürzt — dann **mit** diesem Beleg statt mit einer Vermutung.

## 6. Preset-Kette, einmal durchspielen

Die zweistufigen Preset-Actions haben sich nach dem Delta-Review geändert und
liefen am 22.10.2026 wieder — Slot 1 über den bestätigenden Weg, und das
Rückleseformat ist damit geklärt (siehe oben, immer dreistellig genullt).

Offen bleibt der Recall eines Slots, dessen Inhalt niemand kennt:

| Schritt                                        | Erwartung                                                                |
| ---------------------------------------------- | ------------------------------------------------------------------------ |
| `recall_preset` auf einen belegten Slot ≠ 1    | lädt; im Log kein „is not the slot the receiver has selected"            |
| danach `data.xml` gegen den Stand davor diffen | sehen, was der Slot enthält — **besonders, ob die IP-Adresse dabei ist** |

Der letzte Punkt ist der Grund, das nicht nebenbei zu machen: Enthält ein Preset
eine abweichende IP, ist das Gerät danach nur noch über die Frontblende
erreichbar.

## 7. Nicht auf Sendung, und mit Ansage

| Action                                                    | Warum                                                                                                                     |
| --------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------- |
| `store_preset`                                            | Überschreibt den Slot endgültig. Vorher wissen, was drin war — `recall_preset` auf denselben Slot und den Zustand sichern |
| `reboot_receiver`                                         | Etwa eine Minute ohne Decoder                                                                                             |
| `set_status_pin_mode` / `_state` / `_alarm_level`         | Der Status-Pin hängt unter Umständen in einer Haustechnik. Erst klären, was daran angeschlossen ist                       |
| Routing (`set_asi_output_source`, `set_ip_output_source`) | Nimmt einem nachgelagerten Gerät das Signal weg                                                                           |

Beim Status-Pin meldet das Gerät immer nur **einen** der beiden Pegel zurück,
je nach Modus (siehe Sweep oben). Dass ein Wert ankommt, ist damit im passenden
Modus belegt — ob am Pin tatsächlich die Spannung anliegt, sagt auch das nicht.
Dafür bleibt ein Multimeter der einzige Nachweis.

## Was aus den Ergebnissen folgen kann

Kein Vorgriff, nur die Stellen, an denen ein Testergebnis etwas am Modul ändern
würde:

- Strom unter Last brauchbar → Feedback und Ampel für die Speisung
- `genlock_error` reagiert zuverlässig → Feedback, vielleicht in die Preset-Sektion „Decoder"
- Gerät lehnt Werte sichtbar ab → die Wertelisten könnten doch aus `settings.xml`
  je Verbindung geholt werden, statt die vollen Mengen zu führen (steht als
  offener Punkt in `ROADMAP.md`)
- Composite kommt an Ausgang 1 wirklich heraus → die vier Werte dort bleiben;
  kommt nichts, wird die Liste gekürzt, dann mit Beleg (Abschnitt 5)
