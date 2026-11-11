# Hardware-Tests

Was am Gerät noch nachzuweisen ist, womit, und in welcher Reihenfolge. Die
Ergebnisse kommen in dieses Dokument zurück — dieselbe Stelle, an der auch die
Einschwingzeiten in `LYNX_L2174_API.md` §6 stehen.

## Zuerst: an welchem Gerät

Das Modul schreibt inzwischen 36 Parameter. Vor dem ersten Tastendruck gehört
geklärt, **welcher** Receiver vor einem steht:

| Gerät                                   | Was erlaubt ist                |
| --------------------------------------- | ------------------------------ |
| Laborgerät, nicht auf Sendung           | alles aus diesem Dokument      |
| Ersatzgerät im Rack, nicht zugeschaltet | alles außer Abschnitt 5        |
| Produktivgerät auf Sendung (K7, K6)     | **nichts** aus diesem Dokument |

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

Alles am Laborgerät („Rx Relais", V1039), ohne Antenne und ohne
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

Am 22.10.2026 kamen die beiden unumkehrbaren dazu:

| Action            | Nachweis                                                                                                                       |
| ----------------- | ------------------------------------------------------------------------------------------------------------------------------ |
| `store_preset`    | Slot 16 geladen, **derselbe** Inhalt zurückgespeichert, Slot danach unverändert — die Kette belegt, ohne etwas zu verlieren    |
| `recall_preset`   | zweiter Slot (16: LMST(S) / 10 MHz / FEC 2/3); `DB_IP_ADDRESS` erneut unangetastet                                             |
| `reboot_receiver` | nach **20 s** wieder ansprechbar, Konfiguration unverändert; dazwischen `ECONNREFUSED`, Timeout und `HTTP 404` auf `/data.xml` |

Seit dem 22.10. gibt es zusätzlich `yarn test`: 108 Prüfungen ohne Gerät, die
festhalten, **was jede Action schreibt** — jede Tabellenzeile, jeder Wert, alle
vier Kanäle, gegen eine handgeschriebene Liste der Parameternamen statt gegen
die Tabelle selbst. Was dort nicht drinsteht, ist die Wirkung am Gerät; dafür
sind die Abschnitte unten da.

Am 26.10.2026 kamen die restlichen **18** dazu, alle über eine echte
Companion-Taste: dafür wurde in Companion die temporäre Seite 4 („Labor-Test")
angelegt, ausschließlich auf der Verbindung `lynx-labor` zum Laborgerät, die
Presets aus dem Modul daraufgezogen und über
`POST /api/location/4/<row>/<col>/press` gedrückt. Vor und nach jedem Druck
wurde `data.xml` gelesen und verglichen. `set_guard_interval` war schon am
22.10. auf diesem Weg gedrückt worden und steht der Vollständigkeit halber mit
in der Tabelle.

| Action                       | geschrieben                 | am Gerät gelesen |
| ---------------------------- | --------------------------- | ---------------- |
| `set_guard_interval`         | `Auto` → `1/32`             | ✓ (22.10.)       |
| `set_spectral_polarity`      | `Auto` → `Inverted`         | ✓                |
| `set_channel_enable`         | Kanal 1 `On` → `Off`        | ✓                |
| `set_all_channels`           | `Yes` → `No`                | ✓                |
| `set_asi_output_source`      | `Demodulator` → `Diversity` | ✓                |
| `set_ip_output_source`       | `Off` → `Demodulator`       | ✓                |
| `set_asi_diversity`          | `On` → `Off`                | ✓                |
| `set_diversity_delay`        | `Auto` → `Off`              | ✓                |
| `set_video_input_mode`       | `HD MPEG2 LD` → `H264`      | ✓                |
| `set_genlock`                | `Off` → `SD`                | ✓                |
| `set_video_output_1`         | `SDI+Overlay` → `SDI`       | ✓                |
| `set_video_output_2`         | `SDI` → `SDI+Overlay`       | ✓                |
| `set_overlay_type`           | `Basic` → `Service`         | ✓                |
| `set_overlay_background`     | `100` → `50`                | ✓                |
| `set_overlay_colour`         | `White` → `Green`           | ✓                |
| `set_status_pin_mode`        | `Alarm` → `Manual`          | ✓                |
| `set_status_pin_state`       | `High` → `Low`              | ✓                |
| `set_status_pin_alarm_level` | `High` → `Low` → `High`     | ✓, aber langsam  |

Damit sind **alle 29 Actions** über eine Companion-Taste ausgelöst worden. Das
Gerät stand danach wieder im Ausgangszustand — nach einer Wiederholung von vier
Writes, siehe den dritten Punkt unten; geprüft durch Vergleich von `data.xml`
vorher und nachher.

Drei Beobachtungen aus dem Durchgang:

- **`DB_STATUS_PIN_ALARM_LEVEL` braucht länger als 4 s**, bis der neue Wert in
  `data.xml` steht — mehr sagt die Messung nicht. Nach 4 s meldete der
  Vergleich „keine Änderung", beim nächsten Blick nach ~14 s stand der Wert da;
  wann genau dazwischen er ankam, wurde nicht eingegrenzt. Ohne den zweiten
  Blick wäre das als verworfener Write durchgegangen.
- **`data.xml` wechselt seine Parameter auch mit dem Video-Eingangsmodus**, nicht
  nur mit dem Status-Pin: mit `H264` verschwinden `DB_DECOD_PSF_MODE` und
  `DB_DECOD_GOP`, dafür erscheinen `DB_DECOD_BIT_DEPTH`,
  `DB_DECOD_PICTURE_WIDTH` und `_HEIGHT`.
- **Das Gerät verwirft Writes in einer langen, anhaltenden Serie.** Beim
  Zurückstellen gingen drei von vierzehn Writes mit 1,5 s Abstand verloren, im
  Rücklauf einer; mit 6 s Abstand nahm es sie beim ersten Versuch an. Siehe
  Abschnitt 8 — die daraus zunächst gezogene Erklärung war falsch.

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
  mittleren. Der letzte Schreibvorgang gewinnt nicht. **Seit dem 22.10. hält
  das Modul deshalb je Parameter nur einen Write offen** — am Gerät geprüft,
  der zweite Druck wurde 18,4 s zurückgehalten und gewann dann.
- Die Einschwingzeit eines Moduswechsels hängt von der **Richtung** ab: nach
  `LMST(S)` 1,2 s, zurück nach `DVBT` 1–20 s — und zwar schwankend zwischen
  aufeinanderfolgenden Läufen, nicht konstant. Die früher notierten „20 s"
  galten nur für einen langsamen Lauf.
- **Offen:** In einem Lauf mit 18 s Einschwingzeit hat der Receiver den direkt
  danach abgesetzten zweiten Wert verworfen, ohne dass das Modul eine Warnung
  geloggt hätte. Von Hand nicht nachstellbar (dort war die Umschaltung in 1 s
  fertig). Entweder hat ein Poll den Wert kurz gesehen, bevor das Gerät
  zurücksprang — dann wäre das Ausbleiben der Warnung korrekt —, oder es fehlt
  eine. Braucht einen Lauf, bei dem die langsame Richtung reproduzierbar ist.

**Was der Sweep nicht beantwortet**, und wofür die Abschnitte unten da sind:
ob ein angenommener Wert auch wirkt. Dafür braucht es Signal, Downconverter,
Monitor oder Referenz.

## 1. Downconverter-Speisung: beantwortet am 11.11.2026

Aufbau: Downconverter an RF1, an RF2–RF4 nichts. Gemessen an **einem** Gerät,
in einer Sitzung.

| Zustand                       | RF1                       | RF2   | RF3   | RF4   |
| ----------------------------- | ------------------------- | ----- | ----- | ----- |
| Ausgang, alle Speisungen `On` | **238 mA**                | 59 mA | 42 mA | 59 mA |
| `SET_ALL=Yes`, RF1 auf `Off`  | alle vier gehen auf `Off` |       |       |
| → Strom nach 10 s             | **47 mA**                 | 56 mA | 39 mA | 55 mA |
| `SET_ALL=No`, RF1 auf `Off`   | nur RF1 geht auf `Off`    |       |       |
| → Strom nach 3 s              | **47 mA**                 | 57 mA | 39 mA | 56 mA |

**Der Strom ist der erste Wirkungsnachweis des Moduls.** Bis hierher ließ sich
nur zeigen, dass das Gerät einen geschriebenen Wert zurückliest. 238 mA → 47 mA
zeigt, dass auch Spannung verschwindet.

**Apply-to-all gilt auch unter Last.** Mit `DB_L2174_SET_ALL = Yes` schaltet ein
Druck auf RF1 alle vier Kanäle, mit `No` nur RF1 — dasselbe Verhalten wie am
22.10. am leeren Gerät, jetzt mit echtem Verbraucher.

Zwei Dinge, die man kennen sollte, bevor man die Stromanzeige für ein Feedback
benutzt:

- **„Aus" heißt nicht null.** Es bleiben 47 mA stehen, und die leeren Eingänge
  zeigen 39–59 mA unabhängig vom Schaltzustand. Ein Feedback „Speisung läuft
  wirklich" braucht also einen Bezugswert pro Kanal, keine feste Schwelle.
- **Die Anzeige hinkt, und zwar unterschiedlich.** Mit `SET_ALL=No` war der
  Strom nach 3 s unten, mit `Yes` nach 3 s noch nicht — erst nach 10 s. Das
  Verteilen auf vier Kanäle dauert länger. Für das Verify-Fenster (mindestens
  25 s) unkritisch, aber wer hier misst, urteilt nicht nach drei Sekunden.

`LNB Fault` (Alarmbit 10) blieb in jedem Zustand `0`. Ein Kurzschluss wurde
**nicht** provoziert; ob der Alarm anspricht, ist weiterhin offen.

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

## 4. Referenz: beantwortet am 11.11.2026

Aufbau: AJA Gen10 am F/LOCK-Eingang, Receiver **ohne** Signal
(`DB_DECOD_VIDEO_LOCKED` = `No Lock`), Decoder-Ausgangsnorm
`DB_DECOD_LINE_STD` = `1080I/50`.

| Referenz am F/LOCK       | Genlock `Off` | `SD`                  | `HD`   |
| ------------------------ | ------------- | --------------------- | ------ |
| **SD Blackburst, 50 Hz** | `OK`          | **`OK` — rastet ein** | `Fail` |
| HD Tri-Level, 1080/50    | `OK`          | `Fail`                | `Fail` |
| kein Kabel               | `OK`          | `Fail`                | `Fail` |

**Das Feedback `genlock_failed` ist damit in beide Richtungen bestätigt**: grün
bei passender Referenz, rot bei fehlender _und_ bei unpassender. Es prüft nicht
nur, ob etwas anliegt, sondern ob es zur eingestellten Betriebsart passt — `HD`
mit SD-Blackburst meldet korrekt `Fail`.

Drei Dinge, die dabei anders lagen als vermutet:

- **Genlock braucht kein Video.** Der Receiver rastete ohne jedes Eingangssignal
  ein. Für den Leerlauf ist die Sorge damit ausgeräumt, `Fail` sei dort der
  Normalzustand. Wie sich Genlock **mit** anliegendem Video verhält, ist nicht
  gemessen — siehe Abschnitt 2.
- **Dieser Decoder will SD-Blackburst**, obwohl er selbst 1080i/50 ausgibt. Die
  HD-Tri-Level-Referenz hat er nicht angenommen. Wer `set_genlock` auf `HD`
  stellt, braucht also mehr als eine HD-Ausgangsnorm — ungeklärt ist, welche
  Referenz `HD` erwartet.
- **Die ersten drei Messreihen waren wertlos**, weil das Referenzkabel abgezogen
  war. Sie sahen untereinander völlig stimmig aus und schienen eine
  Geräteeigenschaft zu belegen. Gleiche Ergebnisse aus verschiedenen Gründen
  sind von innen nicht unterscheidbar — wer hier nachmisst, prüft zuerst den
  Steckerkontakt.

**Das Gerät nennt den Zustand selbst beim Namen**: Alarmbit 20,
`Frame not Locked`, geht mit `GEN_LOCK_ERROR` auf `Fail` mit und wieder weg.
Das Modul bildet das Bit bereits ab, also schlagen `alarm_active` und
`alarm_summary` mit an — der Alarmknopf wird rot, nicht nur der Genlock-Knopf.
Das ist richtig so, solange das Gerät es als Störung führt.

**Die Stapelreihenfolge im Preset** (grau gewinnt über rot, wenn Genlock `Off`
ist) ruht auf sechs Messungen an einem Gerät: In allen sechs Durchgängen stand
`GEN_LOCK_ERROR` bei `Off` auf `OK`, nie auf `Fail`. Das stützt die Reihenfolge,
beweist sie aber nicht.

Offen bleiben zwei Fragen: welche Referenzart `set_genlock` auf `HD` erwartet,
und wie sich das Ganze mit anliegendem Video verhält.

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

| Action                                                    | Warum                                                                                                                                                                                            |
| --------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| `store_preset`                                            | Überschreibt den Slot endgültig. Am 22.10. verlustfrei geprüft, indem erst derselbe Slot geladen wurde; für jeden anderen Slot gilt der Rat weiter                                               |
| `reboot_receiver`                                         | Etwa 20 s nicht ansprechbar (gemessen); wie lange bis wieder dekodiert wird, ist ohne Signal offen                                                                                               |
| `set_status_pin_mode` / `_state` / `_alarm_level`         | Am Laborgerät geklärt (24.10., Jan): am Status-Pin hängt **nichts**, die drei sind dort gefahrlos. An einem Gerät im Einsatz kann der Pin in einer Haustechnik stecken — dort weiter erst fragen |
| Routing (`set_asi_output_source`, `set_ip_output_source`) | Nimmt einem nachgelagerten Gerät das Signal weg                                                                                                                                                  |

Beim Status-Pin meldet das Gerät immer nur **einen** der beiden Pegel zurück,
je nach Modus (siehe Sweep oben). Dass ein Wert ankommt, ist damit im passenden
Modus belegt — ob am Pin tatsächlich die Spannung anliegt, sagt auch das nicht.
Dafür bleibt ein Multimeter der einzige Nachweis.

## 8. Wie dicht Writes aufeinander folgen dürfen (26.10.2026)

Am 25.10. stand hier, das Gerät verwerfe Writes auf verschiedene Parameter, die
dichter als ~1,5 s aufeinander folgen. **Das war falsch**, und zwar auf die
lehrreiche Art: aus einem einzigen Durchlauf (drei Writes mit 1,5 s verloren,
dieselben mit 6 s angenommen; die damalige Notiz zählte vier, weil sie den
Rücklauf mitnahm) war eine Schwelle geworden. Zwei Datenpunkte,
eine Erklärung, keine Gegenprobe.

Nachgemessen am Laborgerät:

| Versuch                                       | Abstand                       | Ergebnis           |
| --------------------------------------------- | ----------------------------- | ------------------ |
| 3 Parameter, isoliert                         | 0,2 / 1,0 / 1,5 / 2 / 3 / 4 s | alle übernommen    |
| 4 Parameter nach einem Ausgangswechsel        | 1,5 s                         | alle übernommen    |
| 5 Parameter nach einem Codec-Wechsel          | 1,5 s                         | alle übernommen    |
| **14 Parameter am Stück**                     | **1,5 s**                     | **3 verloren**     |
| dieselben 14 zurück                           | 1,5 s                         | 1 verloren (Codec) |
| 3 Overlay-Parameter, jede Ausgangskombination | 6 s                           | alle übernommen    |

Kurze Folgen übersteht das Gerät also auch bei 0,2 s. Was es nicht übersteht,
ist eine **lange, anhaltende Serie** — vierzehn Writes über einundzwanzig
Sekunden. Der Mechanismus ist nicht geklärt; 6 s ist der kürzeste Abstand, bei
dem noch nie etwas verloren ging, **keine bekannte Schwelle**.

Drei gezielte Versuche, es mit kurzen Folgen zu provozieren, schlugen fehl —
erst die vollständige Nachstellung reproduzierte es. Wer das hier nachmisst,
sollte also nicht nach drei negativen Versuchen aufhören.

**Was daraus folgt:** Eine geräteweite Mindestwartezeit zwischen allen Writes
wäre die falsche Antwort — sie bremste jeden normalen Tastendruck für ein
Problem, das beim normalen Tastendrücken nicht auftritt. Das Modul erzeugt eine
solche Serie an genau einer Stelle selbst: beim Nachholen der zurückgehaltenen
Werte, nachdem der Kontakt zurückkehrt. Nur dort wird seit dem 26.10. entzerrt
(`RELEASE_GAP_MS`, 6 s), und dort kostet die Verzögerung nichts, weil die Werte
ohnehin zu spät sind.

## Was aus den Ergebnissen folgen kann

Kein Vorgriff, nur die Stellen, an denen ein Testergebnis etwas am Modul ändern
würde:

- `set_genlock` auf `HD` mit passender Referenz → die Werteliste behält `HD`
  mit Beleg statt mit Vermutung (am 11.11. nahm das Gerät HD-Tri-Level nicht an)
- Genlock mit anliegendem Video → bestätigt, dass die Messung vom 11.11. nicht
  nur für den Leerlauf gilt
- Gerät lehnt Werte sichtbar ab → die Wertelisten könnten doch aus `settings.xml`
  je Verbindung geholt werden, statt die vollen Mengen zu führen (steht als
  offener Punkt in `ROADMAP.md`)
- Composite kommt an Ausgang 1 wirklich heraus → die vier Werte dort bleiben;
  kommt nichts, wird die Liste gekürzt, dann mit Beleg (Abschnitt 5)
