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

| Action                   | Werte                                      | Worauf achten                                                                             |
| ------------------------ | ------------------------------------------ | ----------------------------------------------------------------------------------------- |
| `set_video_input_mode`   | `SD MPEG2 LD` `HD MPEG2 LD` `H264` `MPEG2` | Bei falschem Codec: schwarz, oder Standbild, oder Blue?                                   |
| `set_video_output_1`     | `SDI` `SDI+Overlay`                        | Overlay erscheint/verschwindet                                                            |
| `set_video_output_2`     | zusätzlich `Composite` `Comp+Overlay`      | Bietet das Gerät Composite überhaupt an? `settings.xml` sagt für Ausgang 1 nein, für 2 ja |
| `set_overlay_type`       | `Basic` `Service`                          | Was steht jeweils drin                                                                    |
| `set_overlay_background` | `Off` … `100`                              | Sichtbarer Unterschied zwischen den Stufen                                                |
| `set_overlay_colour`     | `White` `Green`                            | —                                                                                         |

## 4. Was eine Referenz braucht

| Action        | Werte           | Worauf achten                                                                                     |
| ------------- | --------------- | ------------------------------------------------------------------------------------------------- |
| `set_genlock` | `Off` `SD` `HD` | Geht `DB_DECOD_GEN_LOCK_ERROR` von `OK` auf `Fail`, wenn keine oder die falsche Referenz anliegt? |

Wenn `genlock_error` zuverlässig reagiert, ist das ein Feedback wert — Frame
Lock ist genau die Art Fehler, die man im Bild erst bemerkt, wenn es zu spät
ist.

## 5. Preset-Kette, einmal durchspielen

Die zweistufigen Preset-Actions haben sich nach dem Delta-Review geändert und
sind seitdem **nicht mehr an Hardware gelaufen** — das Laborgerät war schon weg.
Vorher wurde der zweite Schritt ausgelöst, sobald der erste abgeschickt war;
jetzt wartet er, bis das Gerät den gewählten Slot zurückmeldet.

Zu prüfen ist deshalb beides: dass es noch funktioniert, und dass es bei einem
**zweistelligen** Slot funktioniert. Beobachtet wurde bisher nur `001`.

| Schritt                            | Erwartung                                                     |
| ---------------------------------- | ------------------------------------------------------------- |
| `recall_preset` auf Slot 1         | lädt wie bisher                                               |
| `recall_preset` auf Slot **12**    | lädt; im Log kein „is not the slot the receiver has selected" |
| `DB_L2174_PRESET_NUM` danach lesen | notieren, ob `012` oder `12` dort steht                       |

Meldet das Gerät eine andere Schreibweise als erwartet, ist das kein Fehler —
der Vergleich ist numerisch —, aber es gehört in `LYNX_L2174_API.md`.

## 6. Nicht auf Sendung, und mit Ansage

| Action                                                    | Warum                                                                                                                     |
| --------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------- |
| `store_preset`                                            | Überschreibt den Slot endgültig. Vorher wissen, was drin war — `recall_preset` auf denselben Slot und den Zustand sichern |
| `reboot_receiver`                                         | Etwa eine Minute ohne Decoder                                                                                             |
| `set_status_pin_mode` / `_state` / `_alarm_level`         | Der Status-Pin hängt unter Umständen in einer Haustechnik. Erst klären, was daran angeschlossen ist                       |
| Routing (`set_asi_output_source`, `set_ip_output_source`) | Nimmt einem nachgelagerten Gerät das Signal weg                                                                           |

`set_status_pin_state` ist dabei der einzige Parameter im ganzen Modul, den das
Gerät **nicht** in `data.xml` zurückmeldet. Ob er wirkt, lässt sich nur am Pin
selbst messen — ein Multimeter daran ist der einzige Nachweis.

## Was aus den Ergebnissen folgen kann

Kein Vorgriff, nur die Stellen, an denen ein Testergebnis etwas am Modul ändern
würde:

- Strom unter Last brauchbar → Feedback und Ampel für die Speisung
- `genlock_error` reagiert zuverlässig → Feedback, vielleicht in die Preset-Sektion „Decoder"
- Gerät lehnt Werte sichtbar ab → die Wertelisten könnten doch aus `settings.xml`
  je Verbindung geholt werden, statt die vollen Mengen zu führen (steht als
  offener Punkt in `ROADMAP.md`)
- Composite an Ausgang 2 vorhanden → bestätigt die Bestückungs-Annahme in
  `src/controls.ts` bei `video_output_1`
