# AquaSense-WSN — Hardware setup guide

Step-by-step wiring, bring-up and verification for the four ESP32 boards. The pins, names and
rules here are copied from the binding contract [`PROTOCOL_SPEC.md`](PROTOCOL_SPEC.md) §1, §1.1,
§1.2 and §9.3. If this guide and the spec ever disagree, the spec wins.

| Node | What is wired | ESP32 pins used | Diagram |
|------|---------------|-----------------|---------|
| N1 | nothing (ESP32 on-chip temperature sensor, `TEMP_WARN` over-temperature alert) | — | [wiring_N1.png](diagrams/wiring_N1.png) |
| N2 | turbidity probe + LM393 adapter board | 3V3, GND, GPIO34 (A), GPIO27 (D) | [wiring_N2.png](diagrams/wiring_N2.png) |
| N3 | nothing (ESP32 on-chip temperature sensor) | — | [wiring_N3.png](diagrams/wiring_N3.png) |
| N4 | pond status light: 2 LEDs (green, red) + 2 resistors on the breadboard | GPIO25, GPIO27, GND | [wiring_N4.png](diagrams/wiring_N4.png) |

Every board also uses its onboard blue LED on GPIO2 (ON = awake, OFF = sleeping slot) and its USB
port (power + serial at 115200 baud). Only N2 and N4 carry external parts: N1 and N3 are a bare
board on a USB cable and read the temperature sensor built into the ESP32 chip.

---

## 1. What you need

Nothing outside this list is used. Every other "sensor" is an ESP32 on-chip peripheral (spec §1.1).

| Qty | Part | Used on | Photo | What it looks like |
|----:|------|---------|-------|--------------------|
| 4 | ESP32 DevKit V1, ESP32-WROOM-32, 30 pins | N1–N4 | [esp32_devkit_v1.webp](photos/esp32_devkit_v1.webp) | black board, metal can marked "ESP-32" at the antenna end, micro-USB plus EN and BOOT buttons at the other end, 15 male pins down each long side |
| 1 | Turbidity probe | N2 | [turbidity_probe.webp](photos/turbidity_probe.webp) | clear plastic body with two prongs (the IR gap), blue locking ring, 4-pin socket on top |
| 1 | LM393 turbidity adapter board | N2 | [turbidity_board.webp](photos/turbidity_board.webp) | small black board; one edge has two 4-pin male headers, `4 3 2 1` (probe side) above `V D A G` (ESP32 side); 8-pin LM393 chip, blue trimmer pot, two small SMD LEDs |
| 2 | 5 mm LEDs: red, green | N4 | [breadboard_leds.webp](photos/breadboard_leds.webp) | two legs, the longer leg is the anode (+) |
| 2 | Resistors, value unknown (see §1.3) | N4 | [breadboard_leds.webp](photos/breadboard_leds.webp) | light blue-green body with coloured bands |
| 1 | Breadboard | N4 | [breadboard_leds.webp](photos/breadboard_leds.webp) | numbered columns, rows `a–e` and `f–j` either side of a centre gap, `+` / `−` rails along both long edges |
| many | Jumper wires: male-male (M-M), male-female (M-F), female-female (F-F) | N2, N4 | — | see §1.2 |
| 4 | Micro-USB cables (must carry data, not charge-only) | all | — | — |
| 1 | Laptop with a 2.4 GHz mobile hotspot, Arduino IDE, Python 3 | N4 uplink | — | — |

### 1.1 Safety rules (read before touching a wire)

1. **Never connect the turbidity module's `V` to `VIN` (5 V).** At 5 V its `A` output reaches
   4.5 V and `D` swings to 5 V, both above the ESP32's 3.3 V pin limit. Use `3V3` only (see §4.4).
2. **Unplug the USB cable before you plug in or pull out any jumper.** A jumper end that brushes
   the wrong pin while powered can short 3V3 to GND or feed a pin.
3. **LED polarity:** the long leg (anode, `+`) goes towards the resistor and the GPIO. The short
   leg, on the side where the plastic rim has a flat edge, is the cathode and goes to GND. A
   reversed LED does not break anything; it simply stays dark.
4. **No external part on a strapping pin.** GPIO0, 2, 5, 12 and 15 decide how the chip boots. This
   project leaves them free (GPIO2 only drives the onboard LED).
5. **No analog input on ADC2 pins.** GPIO0/2/4/12–15/25–27 cannot be read with `analogRead()`
   while Wi-Fi / ESP-NOW is on, so the only analog input is on ADC1 (GPIO34).
6. **Do not use TX0 / RX0** (GPIO1 / GPIO3): they carry the USB serial link.
7. Keep water away from the boards. Only the turbidity probe gets wet; N1 is a bare board and stays dry.

### 1.2 Jumper cheat-sheet

The DevKit V1 has **male** header pins. The LM393 board has **male** header pins. The breadboard
takes **male** ends. A jumper always needs a female end where it meets a male pin.

| From | To | Jumper |
|------|----|--------|
| ESP32 header pin (male) | LM393 board pin (male) | **F-F** |
| ESP32 header pin (male) | breadboard hole | **M-F** (female end on the ESP32, male end into the breadboard) |
| breadboard hole | breadboard hole / rail | **M-M** |
| probe socket (4 pins) | LM393 board `1 2 3 4` (male) | **F-F** if the probe socket shows 4 metal pins inside a plastic shroud (spec); **M-F** with the male end in the probe if you see 4 holes instead |

**N1 and N3 need no jumpers at all.** The ESP32 boards stay off the breadboard: a 30-pin DevKit V1
covers almost the full width of a breadboard and we have one breadboard for four boards.

### 1.3 The two resistors: reading the bands

Any value from **100 Ω to 1 kΩ** is fine for an LED on a 3.3 V GPIO, so you may use them as they
are. With an LED forward voltage of about 2 V, the current is `(3.3 V − 2 V) / R`:

| R | LED current | Note |
|---|-------------|------|
| 100 Ω | ≈ 13 mA | bright, still well under the ESP32's ≈ 20 mA default drive (40 mA absolute max) |
| 220 Ω | ≈ 5.9 mA | normal |
| 330 Ω | ≈ 3.9 mA | normal |
| 1 kΩ | ≈ 1.3 mA | dim but visible |

A green InGaN LED (forward voltage ≈ 3 V) will be noticeably dimmer than the red one.
Do not use a resistor below 100 Ω and never connect an LED straight to a GPIO without one.

To read the bands: hold the resistor so the gold or brown tolerance band, which sits a little
apart from the others, is on the right. Read left to right. Colour digits: black 0, brown 1, red 2,
orange 3, yellow 4, green 5, blue 6, violet 7, grey 8, white 9. On a **4-band** resistor the first
two bands are digits and the third is the number of zeros. On a **5-band** resistor (common with
the light blue body in the photo) the first three bands are digits and the fourth is the number of
zeros.

| Value | 4-band | 5-band |
|-------|--------|--------|
| 100 Ω | brown, black, brown (+ gold) | brown, black, black, black (+ brown) |
| 220 Ω | red, red, brown | red, red, black, black |
| 330 Ω | orange, orange, brown | orange, orange, black, black |
| 1 kΩ | brown, black, red | brown, black, black, brown |

The bands in our photo are not readable, so check yours. Resistors have no polarity.

### 1.4 ESP32 DevKit V1 (30-pin) pinout

Hold the board **component side up, metal can / antenna at the top, USB connector at the bottom**.
The pin labels printed on the board are shown in the "Label" columns. Pin 1 is the top of each
header (next to the antenna).

| # | Left header label | GPIO | Used on | # | Right header label | GPIO | Used on |
|--:|-------------------|------|---------|--:|--------------------|------|---------|
| 1 | EN | reset | — | 1 | D23 | 23 | — |
| 2 | VP | 36 (input only) | — | 2 | D22 | 22 | — |
| 3 | VN | 39 (input only) | — | 3 | TX0 | 1 (USB serial) | do not use |
| 4 | **D34** | 34 (input only, ADC1_CH6) | **N2 `A`** | 4 | RX0 | 3 (USB serial) | do not use |
| 5 | D35 | 35 (input only) | — | 5 | D21 | 21 | — |
| 6 | D32 | 32 (T9) | — | 6 | D19 | 19 | — |
| 7 | D33 | 33 (T8) | — | 7 | D18 | 18 | — |
| 8 | **D25** | 25 | **N4 green LED** | 8 | D5 | 5 (strapping) | — |
| 9 | D26 | 26 | — | 9 | TX2 | 17 | — |
| 10 | **D27** | 27 | **N2 `D`**, **N4 red LED** | 10 | RX2 | 16 | — |
| 11 | D14 | 14 | — | 11 | D4 | 4 | — |
| 12 | D12 | 12 (strapping) | — | 12 | D2 | 2 (onboard LED, strapping) | all (LED only) |
| 13 | D13 | 13 | — | 13 | D15 | 15 (strapping) | — |
| 14 | **GND** | ground | **N2 `G`**, **N4 GND rail** | 14 | GND | ground | — |
| 15 | VIN | 5 V from USB | **never** for the module | 15 | **3V3** | 3.3 V out | **N2 `V`** |

GPIO27 appears twice in the "Used on" column because N2 and N4 are different boards. N1 and N3
use no header pin at all.

---

## 2. Node N1: sensor node, on-chip temperature sensor (no wiring)

**Parts:** one ESP32 and its USB cable. **Nothing to wire:** no jumper, no breadboard, no external
part. **Diagram:** [wiring_N1.png](diagrams/wiring_N1.png).

### 2.1 What N1 measures

N1 reads the temperature sensor built into its own ESP32 chip with `temperatureRead()` and sends
`v = round(°C × 100)` in its DATA frame (`u = temp`; `-1` if the read returns NaN). The board sits
in the electronics enclosure at the pond edge, so the value is reported as the **pond-edge
enclosure temperature**, not the water temperature (spec §0, §1.2). N3 uses the same sensor for the
enclosure on the bank (§4). Caveats, stated openly on the dashboard and in the report:

- **Uncalibrated.** The classic ESP32 sensor has an offset of several °C that differs from chip to
  chip. Read the value as a trend, not as an absolute temperature.
- **Self-heating warm-up.** Wi-Fi and BLE heat the die, so right after power-on the value climbs for
  a few minutes before it settles (typically in the mid-40s to mid-50s °C). Let N1 run for about
  **5 minutes** before the alert demo, otherwise the reading can still drift across the threshold
  you set.
- **Some chips return a constant 53.33 °C** (raw value 128). The value then never moves. That is a
  chip limitation, not a wiring or firmware fault. On such a chip the alert flag reacts **only to
  the threshold being moved** across 53.33 °C, which is exactly what the demo below does.

### 2.2 The over-temperature alert (`TEMP_WARN`)

N1 sets the DATA flag **`th = 1` when `v >= TEMP_WARN`** (°C × 100). The threshold starts at
`TEMP_WARN_C100 6000` = **60.00 °C** (`config.h`), which a lab board rarely reaches, so in normal
operation `th = 0`. The farmer changes the threshold **live** from the dashboard; no re-flash:

`dashboard form → server → N4 (next CONTROL slot) → broadcast CTRL TEMP_WARN{a:1, v} (relayed once
by N3 and N2) → N1 stores v, logs it, raises an event → reports it back in STAT tw → dashboard
shows nodes[0].temp_warn`.

Accepted range: 0 … 15000 (0.00 … 150.00 °C). **`RESET_STATS`** (*Reset statistics* in view 8)
restores 60.00 °C, and so does a reboot of N1 (the value is not stored in flash).

While N1's flag is 1 the N4 status light **blinks red (state `hot`, `N1 enclosure hot`)**, unless a
higher-priority state applies (steady red for N2 turbidity, blinking green when no data has
arrived for 9 s; spec §9.3).

### 2.3 Demonstration: set the threshold below the live reading

1. Power N1 and let it warm up for about 5 minutes. Read its live value on the Overview N1 tile,
   e.g. **47.78 °C**. The light is green (`all nominal`).
2. Open view 1 (Architecture & Setup) or view 6 (Data Aggregation). In the form **N1
   over-temperature alert threshold**, enter a value 2–3 °C **below** the live reading, e.g.
   **45.00 °C**, and submit.
3. Within one or two superframes (3–6 s): N1 logs `[N1 CTRL] TEMP_WARN 45.00 C (was 60.00 C)`,
   its next DATA carries `th=1`, the N1 tile shows *hot* and the threshold 45.00 °C, and N4 logs
   `[N4 LIGHT] hot: N1 enclosure hot`. The **red LED** on the breadboard blinks (500 ms on, 500 ms
   off).
4. Set the threshold back to **60.00 °C** (or press *Reset statistics* in view 8): `th=0`, N4 logs
   `[N4 LIGHT] green: all nominal`, the **green LED** lights again.

On a chip stuck at 53.33 °C use 53.00 °C in step 2: the flag still flips, because only the
threshold moves.

**Serial fallback (no dashboard).** Type the command into N4's Serial Monitor (115200 baud); N4
broadcasts it exactly like a dashboard command:

```
CMD:{"c":"TEMP_WARN","a":1,"v":4500}      threshold 45.00 C  -> N1 th=1 -> light blinks red
CMD:{"c":"TEMP_WARN","a":1,"v":6000}      threshold 60.00 C  -> N1 th=0 -> light green
```

| Step | Threshold set | N1 reading | N1 `th` | Status light |
|------|---------------|-----------|---------|--------------|
| default | 60.00 °C (`v` 6000) | e.g. 47.78 °C | 0 | green, `all nominal` |
| demo | 45.00 °C (`v` 4500) | e.g. 47.78 °C | 1 | red blinking (`hot`), `N1 enclosure hot` |
| restore | 60.00 °C, or `RESET_STATS` | e.g. 47.78 °C | 0 | green, `all nominal` |

**Verification checklist:**

- [ ] The board's red power LED is on with USB connected; the blue GPIO2 LED blinks with the slots.
- [ ] Serial monitor (115200) shows at boot
      `[N1 SENS] ESP32 die temperature sensor (uncalibrated), now 47.78 C, TEMP_WARN 60.00 C`
      (your temperature differs).
- [ ] Every 10 s: `[N1 TABLE] sensor …: v=<v> … th=0` while the reading is below the threshold.
- [ ] Dashboard Overview: the N1 tile shows a temperature in °C (not −0.01, which would mean `-1`,
      i.e. NaN) and no alert; view 1 shows the N1 threshold 60.00 °C.
- [ ] Threshold set just below the reading: `[N1 CTRL] TEMP_WARN 45.00 C (was 60.00 C)`, then
      `[N1 TX] DATA … temp th=1`, and on N4 `[N4 LIGHT] hot: N1 enclosure hot` (red LED blinking)
      within 3–6 s.
- [ ] Threshold back to 60.00 °C: `[N1 CTRL] TEMP_WARN 60.00 C (was 45.00 C)`, `th=0`, light green.

---

## 3. Node N2: turbidity probe + LM393 adapter board

**Parts:** one ESP32, turbidity probe, LM393 adapter board, **8 female-female jumpers** (4 for
the probe cable, 4 for the ESP32), a small screwdriver for the trimmer.
**Diagram:** [wiring_N2.png](diagrams/wiring_N2.png).

### 3.1 Wiring

Hold the adapter board with its header edge on the right. Reading down that edge you see two
groups of four male pins: **`4 3 2 1`** (probe side) and below them **`V D A G`** (ESP32 side).

**Steps (USB unplugged):**

1. **V → 3V3.** Take a F-F jumper (red). Push one end onto the module pin marked **V**. Push the
   other end onto the ESP32 pin marked **3V3**: right header, bottom pin (next to the USB connector).
2. **G → GND.** Take a F-F jumper (black). Push one end onto the module pin marked **G**. Push the
   other end onto the ESP32 pin marked **GND** on the **left** header, 2nd from the bottom (directly
   above VIN).
3. **A → GPIO34.** Take a F-F jumper (yellow). Push one end onto **A**. Push the other end onto
   **D34**: left header, 4th pin from the top (EN, VP, VN, D34).
4. **D → GPIO27.** Take a F-F jumper (green). Push one end onto **D**. Push the other end onto
   **D27**: left header, 6th pin from the bottom (VIN, GND, D13, D12, D14, D27).
5. **Probe cable, straight through.** Look at the probe's 4-pin socket: small numbers 1–4 are
   printed or moulded next to it. With four F-F jumpers (any colours, ideally grey/white) connect
   probe pin 1 to board pin `1`, 2 to `2`, 3 to `3`, 4 to `4`. If the socket shows holes instead
   of pins, use M-F jumpers with the male end in the probe.
6. Check every wire against the table, then plug in USB.

| Module pin | ESP32 pin (label) | Header position | Jumper | Colour |
|------------|-------------------|-----------------|--------|--------|
| `V` | 3V3 (**3V3**) | right header, bottom pin | F-F | red |
| `G` | GND (**GND**) | left header, 2nd from bottom | F-F | black |
| `A` | GPIO34 (**D34**) | left header, 4th from top | F-F | yellow |
| `D` | GPIO27 (**D27**) | left header, 6th from bottom | F-F | green |

| Probe socket pin | Board header pin | Jumper |
|------------------|------------------|--------|
| 1 | `1` | F-F |
| 2 | `2` | F-F |
| 3 | `3` | F-F |
| 4 | `4` | F-F |

```
  turbidity probe                LM393 board                         ESP32 DevKit V1
  (socket on top)                (header edge on the right)          (USB at the bottom)
                                 +--------------------+
  pin 1 o---- F-F (grey) ------->| 1 o                |
  pin 2 o---- F-F (grey) ------->| 2 o   probe side   |
  pin 3 o---- F-F (grey) ------->| 3 o                |
  pin 4 o---- F-F (grey) ------->| 4 o                |
                                 |                    |
                                 |              V o---+--- F-F red ----> 3V3  (right header, bottom)
                                 |  [trimmer]   D o---+--- F-F green --> D27  (left header, 6th from bottom)
                                 |  LEDs:       A o---+--- F-F yellow -> D34  (left header, 4th from top)
                                 |  PWR + D     G o---+--- F-F black --> GND  (left header, 2nd from bottom)
                                 +--------------------+
  (on the real board the pins read 4 3 2 1 then V D A G from top to bottom along one edge)
```

### 3.2 Why 3V3 and not VIN (a deliberate choice)

The module is **rated 5 V**: at 5 V the analog output spans about 0–4.5 V. We power it from 3V3
**on purpose**, not because the vendor recommends it. At 5 V the `A` output exceeds 3.3 V and the
`D` output swings to 5 V, both over the ESP32 pin limit, and the only two resistors we own are
the LED series resistors, so no voltage divider can be built. At 3.3 V the LM393 (rated 2–36 V)
and the probe's IR pair still work, with a smaller analog swing. The vendor's 5 V NTU formula
does not apply, so we report the **raw ADC count** (12 bit, 11 dB attenuation, 0 … ~3.1 V).

| Water | Voltage on A | Raw ADC (`v`) | `D` output | D LED | `th` |
|-------|-------------|---------------|-----------|-------|------|
| clear | ≈ 1.5–2.3 V | ≈ 1900–2900 | HIGH | off | 0 |
| turbid (milk / soil) | well below | down towards 0–1100 | LOW (past the trimmer threshold) | on | 1 |

The analog value **falls** as turbidity rises. `D` is the LM393 comparator output (open collector
with a pull-up; the ESP32 also enables `INPUT_PULLUP` on GPIO27). The firmware treats LOW as
"turbid" (`TURB_DOUT_ACTIVE_LOW 1`).

### 3.3 Identify the two SMD LEDs, then calibrate the trimmer

The board's two small LEDs are not labelled. One is the **power LED** (on whenever the board has
3.3 V). The other is the **D LED** (on when `D` is LOW). Find out which is which in step 2.

1. Put the probe's prongs into a glass of clear tap water, deep enough to cover the gap.
2. Turn the blue trimmer slowly with the screwdriver through its range. The LED that switches on
   and off is the D LED; the one that stays on is the power LED.
3. In clear water, turn the trimmer until the D LED **just goes off**. Stop there.
4. Add a pinch of milk or soil and stir. The D LED turns on. On the dashboard the N2 chip flips to
   `turbid` and the N4 status light turns **red**.
5. Pour the turbid water away and refill with clear water: the D LED goes off, N2 shows clear.

### 3.4 Probe cable orientation check (pinout not confirmed)

We could not confirm from any datasheet which socket pin is the IR LED supply, ground or receiver
output, so the cable is wired 1→1 … 4→4 and then **checked**:

- With the probe in clear water, turning the trimmer through its range must switch the D LED.
- With the probe in air, putting a finger in the gap between the two prongs must change the raw
  N2 value on the dashboard (or in the serial log) clearly.
- If the value does not move at all, unplug USB and **reverse the four probe jumpers** (probe 1 to
  board `4`, 2 to `3`, 3 to `2`, 4 to `1`), then retest. A probe connected the wrong way round gives
  no signal; at 3.3 V it is not damaged.

**Verification checklist:**

- [ ] The ESP32's power LED and the module's power LED are both on with USB connected.
- [ ] Serial shows `[N2 SENS] turbidity A=GPIO34 (ADC1_CH6, 11 dB, 12 bit) D=GPIO27 (pull-up, active LOW)`
      at boot, and every 10 s `[N2 TABLE] sensor …: v=<v> … th=<0|1>`.
- [ ] Probe in clear water: Overview N2 tile shows a raw value of roughly 1900–2900 and `clear`.
- [ ] Finger in the prong gap / milky water: the value drops clearly.
- [ ] Past the trimmer threshold: D LED on, `[N2 TX] DATA … turb th=1`, N2 chip `turbid`, and on N4
      `[N4 LIGHT] red: turbidity threshold (D)` within 3 s.
- [ ] If the flag is the opposite of the D LED, see Troubleshooting (`th` inverted).

---

## 4. Node N3: cluster head, on-chip temperature sensor

**Parts:** one ESP32 and its USB cable. **Nothing to wire.**
**Diagram:** [wiring_N3.png](diagrams/wiring_N3.png).

N3 reads the same on-chip temperature sensor as N1 (§2) with `temperatureRead()` and sends
`round(°C × 100)` in its aggregate (`-1` if the read returns NaN). It measures the temperature of
the electronics (the "enclosure" on the bank), **not** the water. N3 has no alert threshold
(`TEMP_WARN` applies to N1 only). Caveats, stated openly on the dashboard and in the report:

- The classic ESP32 sensor is **uncalibrated**: expect a reading several °C above room temperature
  (self-heating from Wi-Fi + BLE) and an offset that differs from chip to chip.
- **Some chips return a constant 53.33 °C** (raw value 128). Then the value never moves. That is a
  chip limitation, not a wiring or firmware fault.

**How to demonstrate it:**

1. Open view 6 (Data Aggregation): the N3 input shows the temperature in °C.
2. Right after power-on the value climbs for a few minutes as the radio heats the die.
3. Hold a fingertip, or a cool dry metal spoon, on the metal can marked "ESP-32" for 20 s. The
   value changes within a few superframes and drifts back afterwards. (The die usually runs warmer
   than your skin, so expect the value to go **down**; if your chip reads lower than body
   temperature, it goes up.)

**Verification checklist:**

- [ ] Power LED on; serial shows `[N3 SENS] ESP32 die temperature sensor (uncalibrated), now 47.78 C`
      (your number differs) at boot, and every 10 s `[N3 TABLE] sensor …: v=<v> …`.
- [ ] About 4.5 s after boot: `MASTER N3: initial schedule v1 slots=[3,1,2,3,0,255]`.
- [ ] Overview N3 tile shows a temperature in °C (not −0.01, which would mean `-1`, i.e. NaN).
- [ ] View 6 lists N3's own value next to the N1 and N2 inputs.

---

## 5. Node N4: sink + pond status light on the breadboard

**Parts:** one ESP32, the breadboard, one red and one green LED, 2 resistors, **2 male-male**
jumpers (black), **3 male-female** jumpers (green, red, black).
**Diagram:** [wiring_N4.png](diagrams/wiring_N4.png).

The light has two LEDs. There is no yellow LED: GPIO26 (**D26**) stays unconnected, and the photo
[breadboard_leds.webp](photos/breadboard_leds.webp) still shows the earlier three-LED build.

### 5.1 Breadboard orientation and names

Lay the breadboard flat so the column numbers read 1, 2, 3 … from left to right. Each hole is
named by its **column number and row letter**, e.g. `10i`. Inside one column, holes `a–e` are
connected to each other and holes `f–j` are connected to each other; the centre gap separates
the two halves. The long strips along the edge next to row `j` are the rails: use the one marked
**`−`** (usually a blue line) as the **GND rail**. All holes of a rail are connected along its
length. On a full-size board the rail may be split half way (a break in the printed line); we only
use columns 10–30, so stay on the left half. Rows `a–e` and the `+` rail are not used.

### 5.2 Steps (USB unplugged)

**Green LED (columns 10–14):**

1. Push the green LED's **long leg** (anode) into hole **10i** and its **short leg** (flat rim
   side, cathode) into **11i**.
2. Bend the legs of one resistor and push one leg into **10h**, the other into **14h**.
3. Push a M-M jumper (black) into **11j** and its other end into the **`−` rail** hole right below
   column 11.

**Red LED (columns 24–28; columns 15–23 between the two LEDs stay empty):**

4. Red LED long leg into **24i**, short leg into **25i**.
5. Resistor from **24h** to **28h**.
6. M-M jumper (black) from **25j** to the `−` rail.

**Jumpers to the ESP32** (board component side up, USB at the bottom; D25 and D27 are on the
**left** header with D26 between them, which stays free):

7. M-F jumper (green): male end into **14f**, female end onto **D25** (left header, 8th pin from
   the top = the middle pin).
8. M-F jumper (red): male end into **28f**, female end onto **D27** (left header, 10th from the top,
   6th from the bottom).
9. M-F jumper (black): male end into the **`−` rail** at column 30, female end onto **GND** on the
   left header, 2nd from the bottom (directly above VIN).

| Signal | Breadboard holes | ESP32 pin (label) | Header position | Jumper | Colour |
|--------|------------------|-------------------|-----------------|--------|--------|
| green LED | anode 10i, cathode 11i, R 10h–14h | GPIO25 (**D25**) ← 14f | left, 8th from top | M-F | green |
| red LED | anode 24i, cathode 25i, R 24h–28h | GPIO27 (**D27**) ← 28f | left, 10th from top | M-F | red |
| cathodes | 11j, 25j → `−` rail | — | — | 2 × M-M | black |
| GND rail | `−` rail, column 30 | GND (**GND**) | left, 2nd from bottom | M-F | black |

```
 column:     10 11    14                         24 25    28    30
 row f   .  .  .  .  [G]  .  .  .  .  .   .   .  .  .  .  .  [R]  .  .     G/R = M-F jumper to D25/D27
 row g   .  .  .  .   .   .  .  .  .  .   .   .  .  .  .  .   .   .  .
 row h   . [R1======R1]   .  .  .  .  .  .  .   .  .  . [R2======R2]  .  .     resistors 10h-14h, 24h-28h
 row i   . (+g -)  .  .   .  .  .  .  .   .   .  .  . (+r -)  .   .   .  .     LED: long leg (+) left, short leg (-) right
 row j   .  .  |   .  .   .  .  .  .  .   .   .  .  .  .  |   .   .   .  .     M-M from 11j, 25j
 - rail  ======o=====================================o=============o====    GND rail; column 30 -> ESP32 GND (M-F)
 + rail  ---------------------------------------------------------------    (unused)
```

Electrically, each colour is: `GPIO → jumper → resistor → LED anode → LED cathode → − rail → GND`.

### 5.3 Power-on test

1. Check each LED: long leg in row `i` of the column that also holds the resistor.
2. Plug N4's USB into the laptop. The light stays **off** until the first data arrives
   (`waiting for first data`).
3. Open the dashboard Overview and press **Test light** (sends `LIGHT_TEST`): the light cycles
   **red → green**, one second each, then returns to the data-driven state. This proves
   dashboard → sink → GPIO actuation. Without the dashboard, type `CMD:{"c":"LIGHT_TEST"}` into
   N4's Serial Monitor (115200 baud) for the same test.
4. With N1–N3 running and nothing triggered, the light is **green** (`all nominal`).

| State | LEDs | When (priority top to bottom, spec §9.3) |
|-------|------|------------------------------------------|
| `test` | red, then green | Test light pressed (1 s per colour, 2 s in total) |
| `off` | none | N4 not synced yet / no data received yet |
| `stale` | green **blinking** (500 ms) | no AGG and no direct DATA for 3 superframes (9 s): cluster head or route down |
| `red` | red | water turbid: N2 turbidity comparator tripped (freshest N2 flag is 1) |
| `hot` | red **blinking** (500 ms) | N1 enclosure hot: N1 temperature ≥ its `TEMP_WARN` threshold (freshest N1 flag is 1) while the water is not turbid |
| `green` | green | everything else |

The light follows the **freshest flag the sink holds for each sensor node**, whether it arrived
inside an AGG from N3 or in a DATA frame that reached N4 directly (adaptive routing lets N2 use
`2>4`). It used to read only the latest AGG, so it stayed green when N2 routed `2>4` and reported
turbid water. A flag counts only while its sample is younger than 3 superframes, and one LED at
most is lit at any time.

**Verification checklist:**

- [ ] N4 power LED on; at boot the serial shows
      `[N4 SENS] no sensor on this node (status light on GPIO25/27)`,
      `[N4 LIGHT] status light green=GPIO25 red=GPIO27 (stale after 3 SF, test 1000 ms/colour)`
      and `[N4 LIGHT] off: waiting for first data`.
- [ ] Within 10 s: `hotspot connected, IP …, channel X -> uplink …`.
- [ ] Test light: each of the two LEDs lights once, in the order red, green; the serial shows
      `[N4 LIGHT] LIGHT_TEST from dashboard: red -> green, 1000 ms each (local, not broadcast)`.
- [ ] After the first data: `[N4 LIGHT] green: all nominal`; every 10 s
      `[N4 TABLE] status light <state>: <reason> … | N1 hot th=.. … N2 turbid th=..`.
- [ ] Dashboard Overview: status-light widget shows the same colour as the breadboard.

---

## 6. Flashing and bring-up order

1. **Arduino IDE:** board *ESP32 Dev Module*, **Partition Scheme: Huge APP (3MB No OTA/1MB
   SPIFFS)**, upload speed 921600, Serial Monitor 115200. Library: **ArduinoJson** (6.x or 7.x)
   only. ADC, the temperature sensor and BLE come with the ESP32 core. Flash use with
   Huge APP: N1 1.69 MB, N2 1.68 MB, N3 1.67 MB, N4 1.84 MB (58 %).
2. Open `firmware/wsn_node/wsn_node.ino`. In `config.h` set `#define NODE_ID 1` … `4`, upload, and
   put a label on the board (N1–N4). On N4 also check `UPLINK_SSID`, `UPLINK_PASS`, `UPLINK_URL`.
3. Start in this order:
   1. **Laptop hotspot** on the **2.4 GHz** band.
   2. **Server:** `cd server && ./run.sh`, then open http://127.0.0.1:5050/.
   3. **N4** (joins the hotspot within 10 s).
   4. **N3** (becomes scheduler: `MASTER N3: initial schedule v1`).
   5. **N1**, then **N2**. Give N1 about 5 minutes to warm up before the `TEMP_WARN` demo (§2.3).
4. Place the boards at the table positions of
   [network_topology.png](diagrams/network_topology.png). Within about 10 s the dashboard shows
   4 / 4 active and the badge reads *HARDWARE*.

## 7. Full-system verification (one row per rubric view)

| View | Rubric criterion | What to look for |
|------|------------------|------------------|
| Overview | — | 4/4 active, live N1 °C + hot flag, N2 raw ADC + turbid flag, N3 °C, status-light widget matching the breadboard |
| 1 Architecture & Setup | ESP32 setup (2) | four node cards with role, sensor and **exact pins** (N1 on-chip, N2 GPIO34/27, N3 on-chip, N4 GPIO25/27), threshold flag, N1 `TEMP_WARN` threshold and its form, MACs, channel |
| 2 BLE Localization | (3) | RSSI matrix 12/12 pairs, distances, nearest node, N1 estimate near its true position |
| 3 Wi-Fi MAC | (3) | MAC counters per node; *Run contention test* shows two timelines |
| 4 TDMA Schedule | (2) | slot strip with live cursor; GPIO2 LEDs on N1/N2 go dark in sleep slots |
| 5 Broadcast & Unicast | (1) | HELLO/SCHED/CTRL vs DATA/AGG/STAT/ACK counters, live feed with ACKs |
| 6 Data Aggregation | (2) | N1 temperature + N2 turbidity inputs and N3's own temperature fused into one AGG (N1 and N2 `th` flags carried through), ≈ 50 % packet reduction |
| 7 Adaptive Routing | (2) | *Simulate link failure N1–N3* → route via N2; *Restore* → route back |
| 8 Performance | (2) | metric table and charts; *Export CSV* |
| 9 Demo & Viva | (3) | the 17 steps tick off live; include: N1 `TEMP_WARN` set just below its live reading → light blinks red (back to 60 °C → green), milky water at N2 → light steady red, no data at N4 for 9 s (N3 unplugged and no `2>4` DATA arriving) → light blinks green |

## 8. Troubleshooting

| Symptom | Likely cause | Fix |
|---------|-------------|-----|
| Status light stays off | N4 not synced / no data yet; or wiring | Wait for N3 (`MASTER N3`). Press Test light: if an LED stays dark, it is reversed (long leg must be in row `i` with the resistor), its cathode jumper misses the `−` rail, the GND M-F jumper is missing, or the jumper is on the wrong DevKit pin |
| Light blinks green | `stale` (`no data for 9 s`): no AGG and no direct DATA for 3 superframes | N3 off or rebooting, a link-failure test still active, or N3 on another channel. Check N3's serial and view 7 |
| `th` on N2 is the opposite of the D LED | this board's comparator output is not active-low | Set `TURB_DOUT_ACTIVE_LOW 0` in `config.h` and re-flash N2 (or re-adjust the trimmer, §3.3) |
| N2 raw value never changes | probe cable reversed, `A` on the wrong pin, or `V` missing | Do the orientation check (§3.4); `A` must be on D34 (left, 4th from top), `V` on 3V3 |
| N2 raw value noisy | ambient light into the IR gap, loose jumper, probe moving | Shade the cup, keep the probe still, re-seat the jumpers; 4 samples are already averaged |
| Light blinks red (`hot`, `N1 enclosure hot`) without a demo | `TEMP_WARN` still below the reading from an earlier demo, or this chip's uncalibrated offset reads ≥ 60 °C | Set the threshold back to 60.00 °C in view 1 / view 6, or press **Reset statistics** (view 8, `RESET_STATS`); for a chip that reads hot, use a higher value, e.g. 70.00 °C |
| `TEMP_WARN` has no effect (no `[N1 CTRL] TEMP_WARN …` line) | command not reaching N4 (dashboard offline, typo in the `CMD:` line), N1 without a route, or N1 killed with `NODE_KILL` | Check N4's serial for the command, wait one superframe (it is sent in the next CONTROL slot), copy the `CMD:` line exactly from §2.3, check N1's route in view 7, *Wake* N1 in view 4 |
| N1 `th` does not flip although the threshold is below the reading | the reading was still warming up and is now below the new threshold, or the value is −0.01 °C (NaN) | Read the current value on the Overview tile and set the threshold 2–3 °C below it; reboot N1 if it shows −0.01 °C |
| N1 or N3 shows a constant 53.33 °C | chip without a working temperature sensor | Known ESP32 limitation (§2.1); on N1 demonstrate the alert with a 53.00 °C threshold; say so in the viva |
| Nodes do not see each other | wrong Wi-Fi channel (hotspot on 5 GHz or changed channel) | Use a 2.4 GHz hotspot, keep `AUTO_CHANNEL_FROM_SSID 1`, restart N1–N3 so they rescan |
| Dashboard offline / N4 POST fails | server not running, port mismatch, firewall | Server runs on **port 5050** (macOS AirPlay owns 5000); `UPLINK_URL` must use 5050 and the hotspot IP; allow 5050 in the firewall; fallback `serial_bridge.py` |
| Upload fails: sketch too big | default partition | Select **Huge APP (3MB No OTA/1MB SPIFFS)** |
| Upload fails: no port | charge-only cable or missing USB driver | Use a data cable; install the CP210x / CH340 driver; hold BOOT while the upload starts |
