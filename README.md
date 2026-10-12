# AquaSense — free pond sensing for fishermen

Some fishermen with very little capital told us what they had noticed: when the water in a pond turns
turbid, the fish move into the shallows, and that is the easiest time to fish. What they did not have was
a cheap way to know when it happens, or where their floats had drifted to. AquaSense is built for them. It
is open hardware and open source, free to copy, build and change. Anyone can make the floats from the
guide in this repository and connect them to a dashboard at no cost.

## What you get

- Four small floats built on ESP32 boards. They measure water turbidity and temperature. A small USB
  solar power bank keeps a float running.
- A light at the dock: green when the water is clear and the fish are calm, red when the water is turbid.
- A dashboard that runs on your own laptop. It shows live readings, alerts and the state of the network.
- Approximate float positions on a map, worked out from Bluetooth signal strength. Expect an error of tens
  of centimetres.

## What it costs

About ₹3,000 (≈ $35) in parts for all four nodes. This is approximate and depends on where you buy. There
are no fees and no accounts. Your readings stay on your own laptop.

## Start here, step by step

1. **Download.** On this page press the green **Code** button, then **Download ZIP**, and unzip it. If you
   know git: `git clone https://github.com/dhrusheek/aquasense.git`
2. **Build the floats.** Follow [docs/HARDWARE_SETUP.md](docs/HARDWARE_SETUP.md). It lists every part and
   shows each wire. Two things matter most: never connect the turbidity board to the 5 V pin (use 3V3),
   and unplug the USB cable before you move any wire.
3. **Flash the boards.** Install the Arduino IDE and add the ESP32 core (the "esp32 by Espressif"
   package). Install the ArduinoJson library. Open `firmware/wsn_node/wsn_node.ino`. In `config.h` set
   `NODE_ID` to 1, flash a board, then set it to 2, 3 and 4 for the other three. Choose the board "ESP32
   Dev Module" and the partition scheme "Huge APP". The dock node (number 4) also needs your laptop
   hotspot name and password in `config.h` (`UPLINK_SSID`, `UPLINK_PASS`). Details are in
   [firmware/wsn_node/README.md](firmware/wsn_node/README.md).
4. **Run the dashboard.** You need Python 3 on the laptop. Once, from this folder:
   `python3 -m venv .venv && .venv/bin/pip install -r server/requirements.txt`
   Then start it with `./start.sh` and open <http://127.0.0.1:5050>. To try it without any hardware, run
   `./start.sh --sim`; it plays a pretend pond.
5. **Place the nodes.** Put three nodes on the bank in a triangle. Put the float in the water. Keep
   water away from the boards; only the turbidity probe gets wet.

## How it works

Each float senses the water and sends a small message. The floats talk to each other over a radio mesh of
their own, with no Wi-Fi router needed between them. They take turns in fixed time slots, so each float
can sleep between turns and save power. If a link fails, the network finds another route by itself. The
last node, at the dock, turns the readings into a green or red light and passes them to the dashboard on
your laptop.

## For engineers

- Protocol contract (frames, pins, timing, uplink JSON): [docs/PROTOCOL_SPEC.md](docs/PROTOCOL_SPEC.md)
- Diagrams: `docs/diagrams/*.png`; part photos: `docs/photos/`
- `firmware/` one Arduino sketch for all four roles (ESP-NOW, self-built MAC, TDMA, aggregation, routing)
- `server/` Flask server, serial bridge and network simulator
- `web/` the React dashboard source (`cd web && npm install && npm run build`)
- `start.sh` starts the server, finds the dock node on USB and opens the dashboard

## Help and contact

Stuck while building? Open an issue on GitHub at <https://github.com/dhrusheek/aquasense/issues>. Say
which step you are on and what you see, and include a photo if it helps.

## Licence

MIT. You may use, copy, change and share all of it, including for your own business.

Designed and built end to end by Dhrusheek.
