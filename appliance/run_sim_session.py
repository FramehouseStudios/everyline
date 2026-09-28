#!/usr/bin/env python3
"""Watch a full ST 430-10 session on the simulated cinema server.

Runs SimDcs (fake DCS) and the real CspClient against each other over
loopback, printing every wire exchange and the captions that come out.

Run:  python3 run_sim_session.py
"""

import os
import sys
import threading
import time
import urllib.request

sys.path.insert(0, os.path.dirname(os.path.dirname(os.path.abspath(__file__))))

from appliance.csp import CspClient            # noqa: E402
from appliance.scheduler import CueScheduler   # noqa: E402
from appliance.sim_dcs import SimDcs           # noqa: E402

HERE = os.path.join(os.path.dirname(os.path.abspath(__file__)))
FIX = os.path.join(HERE, "fixtures")


def fetch(url):
    with urllib.request.urlopen(url, timeout=5) as r:
        return r.read().decode("utf-8")


def main():
    rpl = open(os.path.join(FIX, "rpl.xml")).read()
    rpl = rpl.replace("http://dcs.local", "{BASE}")

    def read(name):
        return open(os.path.join(FIX, name)).read()

    files = {
        "/captions/feature_en.xml": read("tt_4287.xml"),
        "/captions/feature_en2.xml": read("tt_4287.xml"),
        "/captions/feature_es.xml": read("tt_cinecanvas.xml"),
    }

    sim = SimDcs(rpl, files).start()
    print(f"[sim] DCS listening on 127.0.0.1:{sim.tcp_port}, "
          f"files on :{sim.http_port}")

    client = CspClient(fetch=fetch, scheduler=CueScheduler(lookahead_ms=750))
    client.connect("127.0.0.1", sim.tcp_port)
    print("[acs] connected (ACS initiates per 6.1)")

    steps = [
        ("announce",),
        ("get_new_lease",),
        ("set_rpl_location", 424242, 10),  # Processing; DCS polls per Annex B
        ("poll_until_ready",),
        ("set_output_mode", True),
        ("update_timeline", 424242, 24),     # 1 s
        ("sleep", 0.3),
        ("update_timeline", 424242, 840),    # 35 s
        ("sleep", 0.3),
        ("update_timeline", 424242, 2400),   # 100 s
        ("sleep", 0.3),
        ("terminate_lease",),
    ]

    seen = [0]

    def show_cues():
        for m in client.scheduler.poll():
            print(f"[cue] {m['lang']:>2} {m['startMs']:>8}ms  "
                  f"{m['text'][:60].replace(chr(10), ' / ')}")

    def drive():
        sim.run_session(steps)

    t = threading.Thread(target=drive, daemon=True)
    t.start()
    try:
        while t.is_alive():
            try:
                client.pump()
            except ConnectionError:
                break
            while seen[0] < len(sim.responses):
                name, rid, code, text = sim.responses[seen[0]]
                seen[0] += 1
                print(f"[wire] {name} rid={rid} status={code} {text}")
            show_cues()
            time.sleep(0.01)
    finally:
        t.join(timeout=10)
        sim.stop()
    print("[done] session complete; "
          f"{len(sim.responses)} wire exchanges, "
          f"{sum(1 for r in sim.responses if r[2] not in (0, 10))} errors")


if __name__ == "__main__":
    main()
