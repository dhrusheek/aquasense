"""Unit tests for state.py: derived metrics (spec §9.2/§11) and the command queue (§9.1).

Run from server/:   ../.venv/bin/python -m unittest discover -s tests -v
"""
from __future__ import annotations

import copy
import os
import sys
import tempfile
import unittest

HERE = os.path.dirname(os.path.abspath(__file__))
sys.path.insert(0, os.path.dirname(HERE))

import config  # noqa: E402
import simulator  # noqa: E402
from state import Store, default_light, empty_uplink, validate_command, validate_uplink  # noqa: E402


def synthetic_uplink(sf: int = 41) -> dict:
    """A hand-built §9.1 uplink with known numbers."""
    up = empty_uplink()
    up.update({"source": "hardware", "sf": sf, "net_time": 123456})
    n1, n2, n3, n4 = up["nodes"]
    n1.update(status="active", last_seen_s=1, value=4812, seq=40, threshold=False, temp_warn=6000,
              route="1>3>4", hops=2,
              delay_ms=215, rx_count=39, first_seq=1, max_seq=40, lost=1,
              mac={"tx": 40, "retx": 2, "ok": 40, "to": 2, "busy": 7, "bo": 35, "col": 0, "def": 3},
              tdma={"slot": 1, "ver": 3, "awake_ms": 1, "sleep_ms": 2, "duty": 33.3},
              ble=[{"id": "N2", "rssi": -65, "dist_cm": 52}])
    n2.update(status="active", last_seen_s=1, value=2610, seq=40, threshold=True, route="2>3>4", delay_ms=500,
              rx_count=40, first_seq=1, max_seq=40, lost=0,
              mac={"tx": 40, "retx": 5, "ok": 40, "to": 5, "busy": 0, "bo": 0, "col": 0, "def": 0})
    n3.update(status="active", last_seen_s=1, value=4812, seq=20, route="3>4", rx_count=20,
              first_seq=1, max_seq=20, lost=0,
              mac={"tx": 20, "retx": 0, "ok": 20, "to": 0, "busy": 0, "bo": 0, "col": 0, "def": 0})
    n4.update(status="active", last_seen_s=0)
    up["schedule"].update(ver=3, why="retx slot for N1",
                          history=[{"ver": 1, "why": "initial", "t": 0},
                                   {"ver": 3, "why": "retx slot for N1", "t": 100}])
    up["aggregation"].update(window=sf, **{"in": 2}, bytes_in=240, bytes_out=130, delay_ms=180,
                             n1={"v": 4812, "q": 40, "ts": 1, "cnt": 1, "mean": 4812, "min": 4812, "max": 4812, "th": 0},
                             n2={"v": 2610, "q": 40, "ts": 1, "cnt": 1, "mean": 2610, "min": 2610, "max": 2610,
                                 "th": 1},
                             n3={"v": 4812},
                             cum={"in": 80, "out": 40, "bytes_in": 9600, "bytes_out": 5200})
    up["localization"]["targets"] = [{"id": "N1", "est": [46.2, 33.9], "true": [50, 30], "err_cm": 5.4,
                                      "anchors": []}]
    up["counters"]["ucast"]["DATA"] = 80
    up["mac_log"] = [{"t": 1, "node": "N1", "ev": "CS_BUSY"}, {"t": 2, "node": "N1", "ev": "BACKOFF 3 slots"}]
    return up


class DerivedMetricsTest(unittest.TestCase):
    """§9.2 derived block on synthetic uplinks."""

    def setUp(self) -> None:
        self.tmp = tempfile.TemporaryDirectory()
        self.store = Store(log_dir=self.tmp.name)

    def tearDown(self) -> None:
        self.tmp.cleanup()

    def test_empty_state_is_well_formed(self) -> None:
        st = self.store.get_state()
        self.assertFalse(st["derived"]["online"])
        self.assertEqual(len(st["nodes"]), 4)
        for k in ("metrics", "series", "demo_flow", "schedule_history", "route_history"):
            self.assertIn(k, st["derived"])
        self.assertEqual(len(st["derived"]["demo_flow"]), 17)

    def test_pdr_loss_delay_retx_reduction(self) -> None:
        d = self.store.ingest(synthetic_uplink(), now=1000.0)
        m = d["metrics"]
        self.assertAlmostEqual(m["pdr"]["N1"], 97.5)
        self.assertAlmostEqual(m["pdr"]["N2"], 100.0)
        self.assertAlmostEqual(m["packet_loss"]["N1"], 2.5)
        self.assertEqual(m["lost_total"], 1)
        self.assertEqual(m["rx_total"], 39 + 40 + 20)
        self.assertEqual(m["delay_ms"]["N1"]["last"], 215)
        self.assertEqual(m["delay_ms"]["N3"]["last"], 180)       # from aggregation.delay_ms
        self.assertEqual(m["retransmissions"], {"N1": 2, "N2": 5, "N3": 0, "N4": 0, "total": 7})
        self.assertAlmostEqual(m["reduction_pct"]["packets"], 50.0)
        self.assertAlmostEqual(m["reduction_pct"]["bytes"], 45.8)
        self.assertEqual(m["loc_err_cm"]["N1"]["last"], 5.4)

    def test_delay_stats_and_dedupe(self) -> None:
        up1 = synthetic_uplink(41)
        self.store.ingest(up1, now=1000.0)
        self.store.ingest(copy.deepcopy(up1), now=1003.0)      # same seq -> not re-sampled
        up2 = synthetic_uplink(42)
        up2["nodes"][0].update(seq=41, delay_ms=415)
        m = self.store.ingest(up2, now=1006.0)["metrics"]
        self.assertEqual(m["delay_ms"]["N1"], {"last": 415, "avg": 315.0, "min": 215, "max": 415})

    def test_throughput_estimate(self) -> None:
        # first uplink: AGG bytes_out (130) + 3 STAT x 40 = 250 B over one superframe (3 s)
        m = self.store.ingest(synthetic_uplink(41), now=1000.0)["metrics"]
        self.assertAlmostEqual(m["throughput_Bps"]["total"], round(250 / 3.0, 1))
        self.assertAlmostEqual(m["throughput_bps"]["total"], round(round(250 / 3.0, 1) * 8, 1))
        # AGG bytes split equally between N1, N2, N3 (all carried)
        self.assertAlmostEqual(m["throughput_Bps"]["N1"], round((130 / 3 + 40) / 3.0, 1))
        # second uplink with the SAME window: AGG bytes not counted again
        m2 = self.store.ingest(synthetic_uplink(41), now=1003.0)["metrics"]
        self.assertAlmostEqual(m2["throughput_Bps"]["total"], round((250 + 120) / 6.0, 1))

    def test_series_and_demo_flow(self) -> None:
        self.store.ingest(synthetic_uplink(41), now=1000.0)
        st = self.store.get_state(now=1001.0)
        s = st["derived"]["series"]
        for k in ("t", "pdr_N1", "pdr_N2", "delay_N1", "delay_N2", "delay_N3", "throughput",
                  "retx_total", "loc_err_N1", "reduction", "value_N1", "value_N2", "value_N3"):
            self.assertEqual(len(s[k]), 1, k)
        self.assertEqual(s["value_N1"], [4812])
        self.assertEqual(s["value_N3"], [4812])                  # raw degC x100, not converted
        f = st["derived"]["demo_flow"]
        for step in ("BLE Discovery", "RSSI Measurement", "Localization", "Wi-Fi Initialization",
                     "Dynamic Schedule Assignment", "Channel Sensing", "Random Backoff",
                     "Scheduled Transmission", "Unicast Communication", "Data Aggregation",
                     "Multi-Hop Routing", "Sink", "Performance Analysis"):
            self.assertTrue(f[step], step)
        for step in ("Link Failure", "Failure Detection", "Alternate Route Selection", "Route Recovery"):
            self.assertFalse(f[step], step)
        # offline after OFFLINE_AFTER_S
        st = self.store.get_state(now=1000.0 + config.OFFLINE_AFTER_S + 1)
        self.assertFalse(st["derived"]["online"])
        self.assertFalse(st["derived"]["demo_flow"]["Sink"])

    def test_failure_recovery_flags_and_route_history(self) -> None:
        self.store.ingest(synthetic_uplink(41), now=1000.0)
        up = synthetic_uplink(42)
        up["nodes"][0]["route"] = "1>2>3>4"
        up["events"] = [{"t": 5, "node": "N1", "type": "route", "msg": "LINK_DOWN N3"}]
        up["links"][1]["blocked"] = True
        d = self.store.ingest(up, now=1003.0)
        self.assertEqual(d["route_history"][-1]["from"], "1>3>4")
        self.assertEqual(d["route_history"][-1]["to"], "1>2>3>4")
        self.assertEqual(d["route_history"][-1]["reason"], "LINK_DOWN N3")
        up3 = synthetic_uplink(43)
        up3["events"] = [{"t": 9, "node": "N1", "type": "route", "msg": "ROUTE RESTORED"}]
        f = self.store.ingest(up3, now=1006.0)["demo_flow"]
        for step in ("Link Failure", "Failure Detection", "Alternate Route Selection", "Route Recovery"):
            self.assertTrue(f[step], step)

    def test_schedule_history_and_persistence(self) -> None:
        self.store.ingest(synthetic_uplink(41), now=1000.0)
        hist = self.store.get_history()["schedule_history"]
        self.assertEqual([h["ver"] for h in hist], [1, 3])
        self.assertTrue(os.path.exists(os.path.join(self.tmp.name, config.UPLINK_LOG_FILE)))
        with open(self.store.metrics_csv_path()) as f:
            lines = f.read().strip().splitlines()
        self.assertEqual(len(lines), 2)
        self.assertTrue(lines[0].startswith("received_at,"))

    def test_validate_uplink(self) -> None:
        self.assertIsNone(validate_uplink(synthetic_uplink()))
        self.assertIsNotNone(validate_uplink({"nodes": []}))
        self.assertIsNotNone(validate_uplink([1, 2]))
        self.assertIsNotNone(validate_uplink(dict(synthetic_uplink(), light="green")))
        old = synthetic_uplink()
        del old["light"]
        self.assertIsNone(validate_uplink(old))                 # pre-light uplinks still valid

    def test_threshold_pass_through(self) -> None:
        up = synthetic_uplink()
        up["nodes"][1]["threshold"] = 1                          # firmware may send the raw th int
        self.store.ingest(up, now=1000.0)
        nodes = {n["id"]: n for n in self.store.get_state(now=1001.0)["nodes"]}
        self.assertIs(nodes["N1"]["threshold"], False)
        self.assertIs(nodes["N2"]["threshold"], True)
        self.assertIsNone(nodes["N3"]["threshold"])
        self.assertIsNone(nodes["N4"]["threshold"])
        self.assertEqual(up["nodes"][1]["threshold"], 1)         # caller's object not mutated

    def test_temp_warn_pass_through(self) -> None:
        self.assertIsNone(self.store.get_state()["nodes"][0]["temp_warn"])    # empty skeleton
        up = synthetic_uplink()
        up["nodes"][0]["temp_warn"] = 4500
        up["nodes"][1]["temp_warn"] = "hot"                     # garbage -> null
        del up["nodes"][2]["temp_warn"]                         # absent -> null
        self.store.ingest(up, now=1000.0)
        nodes = {n["id"]: n for n in self.store.get_state(now=1001.0)["nodes"]}
        self.assertEqual(nodes["N1"]["temp_warn"], 4500)
        self.assertIsInstance(nodes["N1"]["temp_warn"], int)
        self.assertIsNone(nodes["N2"]["temp_warn"])
        self.assertIsNone(nodes["N3"]["temp_warn"])
        self.assertIsNone(nodes["N4"]["temp_warn"])
        up = synthetic_uplink(42)
        up["nodes"][0]["temp_warn"] = 4550.0                     # integral float -> int
        self.store.ingest(up, now=1003.0)
        self.assertEqual(self.store.get_state(now=1004.0)["nodes"][0]["temp_warn"], 4550)

    def test_default_light_when_absent(self) -> None:
        self.assertEqual(self.store.get_state()["light"]["state"], "off")       # empty skeleton
        up = synthetic_uplink()
        del up["light"]
        self.store.ingest(up, now=1000.0)
        st = self.store.get_state(now=1001.0)
        self.assertEqual(st["light"], default_light())
        self.assertEqual(st["light"], {"state": "off", "reason": "no uplink", "since": None,
                                       "pins": {"green": 25, "red": 27}})          # two LEDs only
        self.assertEqual([h["state"] for h in st["derived"]["light_history"]], ["off"])

    def test_light_pass_through_and_history(self) -> None:
        states = [("green", "all nominal", 1000), ("green", "all nominal", 1000),
                  ("red", "turbidity threshold (D)", 7000), ("red", "turbidity threshold (D)", 7000),
                  ("hot", "N1 enclosure hot", 13000),
                  ("stale", "no data for 9 s", 19000), ("stale", "no data for 12 s", 19000),
                  ("green", "all nominal", 25000)]
        for i, (state, reason, since) in enumerate(states):
            up = synthetic_uplink(41 + i)
            up["light"] = {"state": state, "reason": reason, "since": since,
                           "pins": {"green": 25, "red": 27}}
            self.store.ingest(up, now=1000.0 + 3 * i)
        st = self.store.get_state(now=1025.0)
        self.assertEqual(st["light"]["state"], "green")
        self.assertEqual(st["light"]["pins"], {"green": 25, "red": 27})
        hist = st["derived"]["light_history"]
        self.assertEqual([h["state"] for h in hist], ["green", "red", "hot", "stale", "green"])
        self.assertEqual(hist[1], {"t": 7000, "state": "red", "reason": "turbidity threshold (D)",
                                   "received_at": hist[1]["received_at"]})
        self.assertEqual((hist[2]["t"], hist[2]["reason"]), (13000, "N1 enclosure hot"))
        self.assertEqual(hist[3]["reason"], "no data for 9 s")    # reason at the change, not the grown age
        # light_history survives RESET_STATS (it is a history, not a statistic)
        self.store.queue_command(validate_command({"c": "RESET_STATS"})[0])
        self.assertEqual(len(self.store.get_state()["derived"]["light_history"]), 5)

    def test_light_config_has_two_leds(self) -> None:
        self.assertEqual(config.LIGHT_STATES, ("test", "off", "stale", "red", "hot", "green"))
        self.assertEqual(config.LIGHT_PINS, {"green": 25, "red": 27})          # GPIO26 is unused
        self.assertEqual((config.LIGHT_STALE_SF, config.LIGHT_TEST_MS, config.LIGHT_BLINK_MS), (3, 1000, 500))
        self.assertEqual(config.NODE_META[3]["sensor"], "Pond status light (2 LEDs)")

    def test_light_history_capped_at_30(self) -> None:
        for i in range(70):
            up = synthetic_uplink(41 + i)
            up["light"] = {"state": "red" if i % 2 else "green", "reason": "", "since": i}
            self.store.ingest(up, now=1000.0 + i)
        hist = self.store.get_state(now=1100.0)["derived"]["light_history"]
        self.assertEqual(len(hist), config.LIGHT_HISTORY_LEN)
        self.assertEqual(hist[-1]["t"], 69)                      # newest kept, oldest dropped


class CommandQueueTest(unittest.TestCase):
    """§9.1 command validation and queue semantics."""

    def setUp(self) -> None:
        self.tmp = tempfile.TemporaryDirectory()
        self.store = Store(log_dir=self.tmp.name)

    def tearDown(self) -> None:
        self.tmp.cleanup()

    def test_validation(self) -> None:
        cmd, err = validate_command({"c": "LINK_FAIL", "a": 1, "b": 3})
        self.assertIsNone(err)
        self.assertEqual(cmd, {"c": "LINK_FAIL", "a": 1, "b": 3, "dur": 40})
        self.assertIsNotNone(validate_command({"c": "LINK_FAIL", "a": 1, "b": 4})[1])   # not allowed
        self.assertIsNotNone(validate_command({"c": "FORMAT_DISK"})[1])
        self.assertIsNotNone(validate_command({"c": "NODE_KILL", "a": 4})[1])
        self.assertEqual(validate_command({"c": "node_kill", "a": "N2"})[0],
                         {"c": "NODE_KILL", "a": 2, "b": 0, "dur": 30})
        self.assertEqual(validate_command({"c": "SCHED_UPDATE", "a": 9})[0],
                         {"c": "SCHED_UPDATE", "a": 0, "b": 0, "dur": 0})
        self.assertEqual(validate_command({"c": "LIGHT_TEST"}),
                         ({"c": "LIGHT_TEST", "a": 0, "b": 0, "dur": 0}, None))

    def test_temp_warn_validation(self) -> None:
        self.assertIn("TEMP_WARN", config.COMMANDS)
        self.assertEqual((config.TEMP_WARN_DEFAULT_C100, config.TEMP_WARN_MIN_C100,
                          config.TEMP_WARN_MAX_C100), (6000, 0, 15000))
        self.assertEqual(validate_command({"c": "TEMP_WARN", "a": 1, "v": 4500}),
                         ({"c": "TEMP_WARN", "a": 1, "b": 0, "dur": 0, "v": 4500}, None))
        self.assertEqual(validate_command({"c": "temp_warn", "v": "0"})[0]["v"], 0)        # a -> 1
        self.assertEqual(validate_command({"c": "TEMP_WARN", "a": 1, "v": 15000})[0]["v"], 15000)
        self.assertEqual(validate_command({"c": "TEMP_WARN", "a": 1, "v": 4550.0})[0]["v"], 4550)
        for bad in ({"v": -1}, {"v": 15001}, {"v": 99999}, {"v": 45.5}, {"v": "hot"}, {"v": None},
                    {}, {"v": True}, {"a": 2, "v": 4500}):
            body = dict({"c": "TEMP_WARN", "a": 1}, **bad)
            self.assertIsNotNone(validate_command(body)[1], body)
        # no other command carries v
        self.assertNotIn("v", validate_command({"c": "LINK_FAIL", "a": 1, "b": 3, "v": 7})[0])

    def test_temp_warn_queued_with_v(self) -> None:
        item = self.store.queue_command(validate_command({"c": "TEMP_WARN", "a": 1, "v": 4500})[0])
        self.assertEqual(item["v"], 4500)
        popped = self.store.pop_commands()
        self.assertEqual(popped, [{"c": "TEMP_WARN", "a": 1, "b": 0, "dur": 0, "v": 4500, "id": item["id"]}])
        self.assertEqual(self.store.recent_commands()[0]["v"], 4500)

    def test_queue_pop_recent(self) -> None:
        a = self.store.queue_command(validate_command({"c": "CONTENTION_TEST"})[0])
        b = self.store.queue_command(validate_command({"c": "LINK_FAIL", "a": 1, "b": 3, "dur": 10})[0])
        self.assertEqual(b["id"], a["id"] + 1)
        popped = self.store.pop_commands()
        self.assertEqual([c["id"] for c in popped], [a["id"], b["id"]])
        self.assertEqual(set(popped[1]), {"c", "a", "b", "dur", "id"})
        self.assertEqual(self.store.pop_commands(), [])
        recent = self.store.recent_commands()
        self.assertEqual([r["status"] for r in recent], ["delivered", "delivered"])

    def test_reset_stats_clears_accumulators(self) -> None:
        self.store.ingest(synthetic_uplink(41), now=1000.0)
        self.store.queue_command(validate_command({"c": "RESET_STATS"})[0])
        st = self.store.get_state(now=1001.0)
        self.assertEqual(st["derived"]["metrics"]["delay_ms"], {})
        self.assertEqual(st["derived"]["series"]["t"], [])


class SimulatorSensorLightTest(unittest.TestCase):
    """simulator.py follows spec §1.2 (sensor models), §7 (OR-fused th) and §9.3 (light)."""

    def run_sf(self, net: "simulator.Network", n: int) -> dict:
        up = {}
        for _ in range(n):
            net.step()
            up = net.uplink()
        return up

    def test_sensor_ranges_and_codes(self) -> None:
        self.assertEqual(simulator.SENSOR_CODE, {1: "temp", 2: "turb", 3: "temp"})
        net = simulator.Network(seed=5)
        up = self.run_sf(net, 5)
        n = {x["id"]: x for x in up["nodes"]}
        self.assertTrue(4400 <= n["N1"]["value"] <= 5300, n["N1"]["value"])      # ~46..52 °C
        self.assertTrue(2500 <= n["N2"]["value"] <= 2700, n["N2"]["value"])
        self.assertTrue(4500 <= n["N3"]["value"] <= 5700, n["N3"]["value"])
        self.assertIs(n["N1"]["threshold"], False)
        self.assertIs(n["N2"]["threshold"], False)
        self.assertIsNone(n["N3"]["threshold"])
        self.assertEqual(n["N1"]["temp_warn"], 6000)
        self.assertEqual([n[k]["temp_warn"] for k in ("N2", "N3", "N4")], [None, None, None])
        self.assertEqual(up["light"]["state"], "green")
        self.assertEqual(up["light"]["reason"], "all nominal")
        self.assertEqual(up["light"]["pins"], {"green": 25, "red": 27})
        self.assertEqual(net.light_leds, {"green": True, "red": False})          # steady green
        self.assertEqual([m["sensor"] for m in up["nodes"]],
                         ["ESP32 die temperature", "Turbidity (LM393 module)",
                          "ESP32 die temperature", "Pond status light (2 LEDs)"])

    def test_episodes_drive_th_and_light(self) -> None:
        net = simulator.Network(seed=2)
        self.run_sf(net, 2)
        net.set_episode("turbid", True)
        up = self.run_sf(net, 2)
        self.assertEqual(up["aggregation"]["n2"]["th"], 1)
        self.assertIs(up["nodes"][1]["threshold"], True)
        self.assertEqual((up["light"]["state"], up["light"]["reason"]), ("red", "turbidity threshold (D)"))
        self.assertEqual(net.light_leds, {"green": False, "red": True})          # steady red
        net.set_episode("turbid", False)
        self.assertFalse(net.set_episode("n1", True))          # only N2 has a sensor episode
        self.assertEqual(self.run_sf(net, 2)["light"]["state"], "green")

    def test_temp_warn_drives_th_and_hot(self) -> None:
        net = simulator.Network(seed=2)
        up = self.run_sf(net, 4)
        self.assertEqual(up["nodes"][0]["temp_warn"], 6000)
        self.assertIs(up["nodes"][0]["threshold"], False)
        cmd = simulator.demo_command(net, {"c": "TEMP_WARN", "a": 1, "v": "live-100"})
        self.assertEqual(cmd["v"], net.sink_val[1]["value"] - 100)
        before = net.counters["bcast"]["CTRL"]
        net.accept_commands([dict(cmd, b=0, dur=0, id=1)])
        up = self.run_sf(net, 3)
        self.assertGreater(net.counters["bcast"]["CTRL"], before)              # broadcast CTRL
        self.assertEqual(up["nodes"][0]["temp_warn"], cmd["v"])                 # STAT.tw -> uplink
        self.assertIs(up["nodes"][0]["threshold"], True)
        self.assertEqual(up["aggregation"]["n1"]["th"], 1)
        # only N1's flag is 1 -> "hot": the red LED blinks, the green one stays off
        self.assertEqual(up["aggregation"]["n2"]["th"], 0)
        self.assertIs(up["nodes"][1]["threshold"], False)
        self.assertEqual((up["light"]["state"], up["light"]["reason"]), ("hot", "N1 enclosure hot"))
        self.assertTrue(any(e["msg"] == "light -> hot" for e in up["events"]))
        leds = []
        for k in range(4):                                       # 500 ms blink half-period
            net._eval_light(net.t + k * simulator.LIGHT_BLINK_MS)
            leds.append(dict(net.light_leds))
        self.assertEqual([x["red"] for x in leds], [True, False, True, False])
        self.assertFalse(any(x["green"] for x in leds))
        self.assertEqual(net.light["state"], "hot")
        # turbid water beats the hot enclosure (red > hot), and hot returns when the water clears
        net.set_episode("turbid", True)
        up = self.run_sf(net, 2)
        self.assertEqual((up["aggregation"]["n1"]["th"], up["aggregation"]["n2"]["th"]), (1, 1))
        self.assertEqual(up["light"]["state"], "red")
        net.set_episode("turbid", False)
        self.assertEqual(self.run_sf(net, 2)["light"]["state"], "hot")
        msg = "TEMP_WARN %.2f C (was 60.00 C)" % (cmd["v"] / 100.0)
        self.assertTrue(any(e["node"] == "N1" and e["msg"] == msg for e in up["events"]), msg)
        net.accept_commands([{"c": "TEMP_WARN", "a": 1, "b": 0, "dur": 0, "v": 6000, "id": 2}])
        up = self.run_sf(net, 3)
        self.assertEqual(up["nodes"][0]["temp_warn"], 6000)
        self.assertEqual(up["light"]["state"], "green")
        # out-of-range v is ignored, RESET_STATS restores the default
        self.assertFalse(net.set_temp_warn(20000, net.t))
        self.assertTrue(net.set_temp_warn(100, net.t))
        net.accept_commands([{"c": "RESET_STATS", "a": 0, "b": 0, "dur": 0, "id": 3}])
        up = self.run_sf(net, 3)
        self.assertEqual(up["nodes"][0]["temp_warn"], 6000)

    def test_demo_timeline_has_temp_warn_episode(self) -> None:
        tl = {at: c for at, c in simulator.DEMO_TIMELINE}
        self.assertEqual(tl[110.0], {"c": "TEMP_WARN", "a": 1, "v": "live-100"})
        self.assertEqual(tl[118.0], {"c": "TEMP_WARN", "a": 1, "v": 6000})
        self.assertEqual(simulator.DEMO_EPISODES, [(15.0, 25.0, "turbid")])

    def test_demo_timeline_fires_every_entry_at_3s_steps(self) -> None:
        # uplinks come every 3 s: phases 108, 111, 114, 117, 120 (= next cycle 0). 118 s must still fire.
        fired: set = set()
        seen = []
        for k in range(0, 2 * 40 + 1):                       # two full cycles + the wrap
            seen += [(k * 3, c["c"], c.get("v")) for _i, c in simulator.due_demo_commands(k * 3.0, fired)]
        first = [x for x in seen if x[0] <= 120]
        self.assertEqual([x[1] for x in first], ["LINK_FAIL", "LINK_RESTORE", "CONTENTION_TEST",
                                                 "SCHED_UPDATE", "TEMP_WARN", "TEMP_WARN"])
        self.assertEqual(first[-2], (111, "TEMP_WARN", "live-100"))
        self.assertEqual(first[-1], (120, "TEMP_WARN", 6000))        # restore, 2 s after 118 s
        self.assertEqual(len(seen), 2 * len(simulator.DEMO_TIMELINE))  # nothing fires twice

    def test_light_test_cycles_red_then_green(self) -> None:
        net = simulator.Network(seed=4)
        self.run_sf(net, 2)
        net.accept_commands([{"c": "LIGHT_TEST", "a": 0, "b": 0, "dur": 0, "id": 1}])
        before = net.counters["bcast"]["CTRL"]
        up = self.run_sf(net, 1)
        self.assertEqual((up["light"]["state"], up["light"]["reason"]), ("test", "LIGHT_TEST"))
        self.assertTrue(any(e["msg"] == "light -> test" for e in up["events"]))
        self.assertEqual(net.counters["bcast"]["CTRL"], before)   # N4 only, not broadcast
        self.assertEqual(self.run_sf(net, 1)["light"]["state"], "green")  # 2 s in total
        # the two phases: red for LIGHT_TEST_MS, then green for LIGHT_TEST_MS, never both
        t = net.t
        net._apply_ctrl({"c": "LIGHT_TEST"}, t)
        seen = []
        for dt in (0, 999, 1000, 1999, 2000):
            net._eval_light(t + dt)
            seen.append((net.light["state"], net.light_leds["red"], net.light_leds["green"]))
        self.assertEqual(seen, [("test", True, False), ("test", True, False), ("test", False, True),
                                ("test", False, True), ("green", False, True)])

    def test_stale_needs_no_agg_and_no_direct_data(self) -> None:
        net = simulator.Network(seed=4)
        self.run_sf(net, 2)
        # cluster head down: no AGG any more, but N2 re-routes 2>4 and its DATA keeps the light fresh
        net.accept_commands([{"c": "NODE_KILL", "a": 3, "b": 0, "dur": 120, "id": 2}])
        for _ in range(6):
            up = self.run_sf(net, 1)
            self.assertEqual(up["light"]["state"], "green", up["light"])
        self.assertEqual(up["nodes"][1]["route"], "2>4")
        self.assertGreaterEqual(net.t - net.last_agg_rx, 3 * simulator.SF_MS)   # the old rule said stale
        # nothing reaches the sink at all -> stale after 3 superframes: the green LED blinks
        net.accept_commands([{"c": "NODE_KILL", "a": k, "b": 0, "dur": 120, "id": 2 + k} for k in (1, 2)])
        up = self.run_sf(net, 5)
        self.assertEqual(up["light"]["state"], "stale")
        self.assertRegex(up["light"]["reason"], r"^no data for \d+ s$")
        age = int(up["light"]["reason"].split()[3])
        self.assertGreaterEqual(age, 9)
        self.assertTrue(any(e["msg"] == "light -> stale" for e in up["events"]))
        # the light went stale 9 s after the last sample (found by the service loop, within one slot)
        self.assertTrue(-5 <= up["light"]["since"] - (net.last_sample_rx + 9000) <= simulator.SLOT_MS + 5)
        leds = []
        for k in range(4):
            net._eval_light(net.t + k * simulator.LIGHT_BLINK_MS)
            leds.append(dict(net.light_leds))
        self.assertEqual([x["green"] for x in leds], [True, False, True, False])
        self.assertFalse(any(x["red"] for x in leds))
        # like the firmware, the reason carries the age and keeps growing while the state stays stale
        up2 = self.run_sf(net, 2)
        self.assertEqual(up2["light"]["state"], "stale")
        self.assertEqual(int(up2["light"]["reason"].split()[3]), age + 6)
        self.assertEqual(up2["light"]["since"], up["light"]["since"])

    def test_direct_path_flag_drives_light(self) -> None:
        """Regression: N2 routed 2>4 bypasses N3, so the AGG carries no n2 — the light must still turn red."""
        net = simulator.Network(seed=2)
        self.run_sf(net, 2)
        net.accept_commands([{"c": "LINK_FAIL", "a": 2, "b": 3, "dur": 60, "id": 1}])
        self.run_sf(net, 2)                                    # N2: LINK_DOWN N3 -> next hop N4
        self.assertEqual(net.nodes[2].nh, 4)
        net.set_episode("turbid", True)
        up = self.run_sf(net, 1)
        self.assertEqual(up["nodes"][1]["route"], "2>4")
        self.assertEqual(net.sink_val[2]["path"], "2>4")         # raw DATA, not aggregated
        self.assertEqual(up["aggregation"]["window"], up["sf"] - 1)   # an AGG did arrive this superframe...
        self.assertIsNone(up["aggregation"]["n2"])               # ...without n2
        self.assertEqual(up["aggregation"]["n1"]["th"], 0)
        self.assertIs(up["nodes"][1]["threshold"], True)
        self.assertEqual((up["light"]["state"], up["light"]["reason"]), ("red", "turbidity threshold (D)"))
        self.assertEqual(net.light_leds, {"green": False, "red": True})
        self.assertTrue(any(e["msg"] == "light -> red" for e in up["events"]))

    def _agg(self, net: "simulator.Network", q: int, **parts: dict) -> dict:
        """A minimal AGG frame as N3 would send it, with the given n1 / n2 parts."""
        qs = {o: [(p["q"], p["ts"], p["v"], p["th"])] for o, p in ((1, parts.get("n1")), (2, parts.get("n2"))) if p}
        return {"t": "AGG", "q": q, "ts": int(net.t), "o": 3, "w": q, "in": len(parts), "bi": 200, "bo": 120,
                **parts, "n3": {"v": 5000}, "p": "3", "hop": 1, "ttl": 4, "red": 50.0, "_qs": qs}

    def _data(self, o: int, q: int, th: int, t: float, p: str) -> dict:
        return {"t": "DATA", "q": q, "ts": int(t), "o": o, "v": 1400 if o == 2 else 4800,
                "u": simulator.SENSOR_CODE[o], "th": th, "p": p, "hop": 1, "ttl": 4}

    def test_light_follows_freshest_flag_per_node(self) -> None:
        net = simulator.Network(seed=6)
        self.run_sf(net, 1)
        self.assertEqual(net.light["state"], "green")
        t = net.t
        part1 = {"v": 4800, "q": 900, "ts": int(t), "cnt": 1, "th": 0}
        # N2 turbid on the direct path, then an AGG without n2: the direct flag is kept -> red
        net._sink_data(self._data(2, 900, 1, t, "2"), t + 10)
        self.assertEqual(net.light["state"], "red")
        net._sink_agg(self._agg(net, 900, n1=part1), t + 20)
        self.assertEqual((net.light["state"], net.light["reason"]), ("red", "turbidity threshold (D)"))
        # only N1's flag is 1 (raw 1>2>4 DATA), N2 clear again -> hot
        net._sink_data(self._data(2, 901, 0, t, "2"), t + 30)
        self.assertEqual(net.light["state"], "green")
        net._sink_data(self._data(1, 901, 1, t, "1>2"), t + 40)
        self.assertEqual((net.light["state"], net.light["reason"]), ("hot", "N1 enclosure hot"))
        # the newest arrival wins, whichever way it came: an AGG with n1.th = 0 clears it
        net._sink_agg(self._agg(net, 901, n1=dict(part1, q=902)), t + 50)
        self.assertEqual(net.light["state"], "green")
        # an AGG part sets the flag too (OR-fused n2.th), and red beats hot
        net._sink_agg(self._agg(net, 902, n1=dict(part1, q=903, th=1),
                                n2={"v": 1400, "q": 903, "ts": int(t), "cnt": 1, "th": 1}), t + 60)
        self.assertEqual(net.light["state"], "red")
        # a flag counts only while its sample is younger than 3 superframes: N2 goes silent, N1 keeps reporting
        stale_ms = simulator.LIGHT_STALE_SF * simulator.SF_MS
        net._sink_data(self._data(1, 904, 0, t, "1>2"), t + 60 + stale_ms - 1)
        self.assertEqual(net.light["state"], "red")
        net._sink_data(self._data(1, 905, 0, t, "1>2"), t + 60 + stale_ms)
        self.assertEqual((net.light["state"], net.light["reason"]), ("green", "all nominal"))
        self.assertEqual([e["msg"] for e in net.events if e["type"] == "light"][-6:],
                         ["light -> red", "light -> green", "light -> hot", "light -> green",
                          "light -> red", "light -> green"])

    def test_light_off_until_first_sample(self) -> None:
        net = simulator.Network(seed=6)
        net.last_sample_rx = None                               # as at boot, before any AGG / DATA
        net._eval_light(net.t)
        self.assertEqual((net.light["state"], net.light["reason"]), ("off", "waiting for first data"))
        self.assertEqual(net.light_leds, {"green": False, "red": False})
        self.assertNotIn("yellow", config.LIGHT_STATES)        # there is no yellow LED and no such state


if __name__ == "__main__":
    unittest.main()
