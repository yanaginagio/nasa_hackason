#!/usr/bin/env python3
"""Fetch the NASA data and footage for the launch, cruise and landing prologue.

Writes rover-replay/assets/voyage.json and, when ffmpeg is available, the video
clips in rover-replay/assets/voyage/.

  python3 tools/prepare_voyage.py [--ffmpeg PATH] [--skip-video]

Sources
- JPL Horizons: the Mars 2020 spacecraft (-168), Earth and Mars, heliocentric
  ecliptic positions once a day from launch to arrival.
- NASA NeoWs (api.nasa.gov): near-Earth asteroids that passed Earth in the
  launch week (30 Jul - 5 Aug 2020).
- NASA Image and Video Library: the launch coverage (ISO B-roll, NASA) and the
  descent and touchdown footage (NASA/JPL-Caltech), with its caption track.
- NASA Photojournal PIA23970: the Jezero hazard map used for Terrain-Relative
  Navigation (blue safe, red hazardous, green dot = landing spot).
"""
import argparse
import json
import math
import os
import re
import shutil
import subprocess
import tempfile
from pathlib import Path
from urllib.parse import quote, urlencode
from urllib.request import urlopen

ROOT = Path(__file__).resolve().parents[1] / "rover-replay"
ASSETS = ROOT / "assets"
HORIZONS = "https://ssd.jpl.nasa.gov/api/horizons.api"
NEOWS = "https://api.nasa.gov/neo/rest/v1/feed"
VIDEO = "https://images-assets.nasa.gov/video"
LAUNCH_ID = "KSC-20200730-VP-MMS01-0001-Mars_2020_Live_Launch_Coverage_ISO_Broll_String-3254502"
LANDING_ID = "JPL-20210222-M2020f-0001-Perseverance Rover’s Descent and Touchdown on Mars"
LAUNCH_UTC = "2020-07-30T11:50:00Z"   # Horizons header for -168
HAZARD_MAP = ("https://assets.science.nasa.gov/dynamicimage/assets/science/psd/photojournal/"
              "pia/pia23/pia23970/PIA23970.jpg")
AU_KM = 149_597_870.7
C_KM_S = 299_792.458

# Clips: (output name, source id, [(start s, end s), ...]). Times are positions in
# NASA's files, checked against contact sheets of the footage.
CLIPS = [
    # Pad camera: ignition and liftoff, then the wide view of the pad.
    ("liftoff.mp4", LAUNCH_ID, [(300.0, 307.0), (318.0, 331.0)]),
    # Camera on the Atlas booster: climb, solid booster separation, Earth's horizon.
    ("ascent.mp4", LAUNCH_ID, [(1040.0, 1056.0), (1116.0, 1146.0), (1170.0, 1200.0)]),
    # Camera on the Centaur: the spacecraft separates and drifts away.
    ("separation.mp4", LAUNCH_ID, [(1468.0, 1500.0)]),
    # Descent: parachute to first ground view, then backshell separation to touchdown.
    ("landing.mp4", LANDING_ID, [(12.0, 52.0), (106.0, 200.0)]),
]


def fetch(url, timeout=60):
    with urlopen(url, timeout=timeout) as response:
        return response.read()


def horizons_vectors(command, start, stop, step="1 d"):
    params = {
        "format": "json", "COMMAND": f"'{command}'", "OBJ_DATA": "NO", "MAKE_EPHEM": "YES",
        "EPHEM_TYPE": "VECTORS", "CENTER": "'500@10'", "START_TIME": f"'{start}'",
        "STOP_TIME": f"'{stop}'", "STEP_SIZE": f"'{step}'", "VEC_TABLE": "'2'",
        "REF_PLANE": "ECLIPTIC", "CSV_FORMAT": "YES", "OUT_UNITS": "'KM-S'",
    }
    result = json.loads(fetch(f"{HORIZONS}?{urlencode(params)}"))["result"]
    body = result.split("$$SOE", 1)[1].split("$$EOE", 1)[0]
    rows = []
    for line in body.strip().splitlines():
        cells = [cell.strip() for cell in line.split(",")]
        # JDTDB, Calendar Date (TDB), X, Y, Z, VX, VY, VZ
        date = re.search(r"(\d{4}-\w{3}-\d{2} \d{2}:\d{2})", cells[1]).group(1)
        x, y, z, vx, vy, vz = (float(value) for value in cells[2:8])
        rows.append({"date": date, "p": (x, y, z), "v": (vx, vy, vz)})
    return rows


def trajectory():
    start, stop = "2020-07-30 13:00", "2021-02-18 13:00"
    craft = horizons_vectors("-168", start, stop)
    earth = horizons_vectors("399", start, stop)
    mars = horizons_vectors("499", start, stop)
    if not (len(craft) == len(earth) == len(mars)):
        raise ValueError("Horizons returned tables of different lengths")
    days, travelled = [], 0.0
    for index, (c, e, m) in enumerate(zip(craft, earth, mars)):
        if index:
            travelled += math.dist(c["p"], craft[index - 1]["p"])
        days.append({
            "day": index,
            "date": c["date"][:11],
            "craft": [round(c["p"][0] / AU_KM, 5), round(c["p"][1] / AU_KM, 5)],
            "earth": [round(e["p"][0] / AU_KM, 5), round(e["p"][1] / AU_KM, 5)],
            "mars": [round(m["p"][0] / AU_KM, 5), round(m["p"][1] / AU_KM, 5)],
            "earthKm": round(math.dist(c["p"], e["p"])),
            "marsKm": round(math.dist(c["p"], m["p"])),
            "sunSpeed": round(math.hypot(*c["v"]), 2),
            "lightSec": round(math.dist(c["p"], e["p"]) / C_KM_S, 1),
            "pathKm": round(travelled),
        })
    return days


def asteroids():
    params = {"start_date": "2020-07-30", "end_date": "2020-08-05",
              "api_key": os.environ.get("NASA_API_KEY", "DEMO_KEY")}
    data = json.loads(fetch(f"{NEOWS}?{urlencode(params)}"))
    rows = {}
    for objects in data["near_earth_objects"].values():
        for item in objects:
            approach = item["close_approach_data"][0]
            name = item["name"].strip()
            name = re.sub(r"^\d+\s+", "", name).strip("()")
            rows.setdefault(name, {
                "name": name,
                "date": approach["close_approach_date_full"],
                "diameterM": round(item["estimated_diameter"]["meters"]["estimated_diameter_max"]),
                "speedKmS": round(float(approach["relative_velocity"]["kilometers_per_second"]), 1),
                "missLunar": round(float(approach["miss_distance"]["lunar"]), 1),
                "missKm": round(float(approach["miss_distance"]["kilometers"])),
                "url": item["nasa_jpl_url"],
            })
    nearest = sorted(rows.values(), key=lambda row: row["missLunar"])
    return {"count": len(rows), "nearest": nearest[:6]}


def landing_callouts():
    """Speed and altitude called out in mission control, from NASA's caption track."""
    url = f"{VIDEO}/{quote(LANDING_ID)}/{quote(LANDING_ID)}.srt"
    text = fetch(url).decode("utf-8-sig")
    cues = []
    for block in re.split(r"\n\s*\n", text.strip()):
        lines = block.strip().splitlines()
        if len(lines) < 3:
            continue
        match = re.match(r"(\d+):(\d+):(\d+),(\d+)", lines[1])
        h, m, s, ms = (int(group) for group in match.groups())
        cues.append((h * 3600 + m * 60 + s + ms / 1000, " ".join(lines[2:])))
    return [{"t": round(t, 2), "text": line} for t, line in cues]


def cut_clips(ffmpeg, out_dir):
    out_dir.mkdir(parents=True, exist_ok=True)
    for name, source, ranges in CLIPS:
        rendition = "medium" if source == LANDING_ID else "large"
        url = f"{VIDEO}/{quote(source)}/{quote(source)}~{rendition}.mp4"
        with tempfile.TemporaryDirectory() as tmp:
            parts = []
            for index, (start, end) in enumerate(ranges):
                part = Path(tmp) / f"part{index}.mp4"
                subprocess.run([
                    ffmpeg, "-hide_banner", "-loglevel", "error", "-y",
                    "-ss", str(start), "-t", str(end - start), "-i", url,
                    "-vf", "scale=-2:540,fps=30", "-c:v", "libx264", "-preset", "slow",
                    "-crf", "27" if source == LANDING_ID else "29", "-pix_fmt", "yuv420p",
                    "-c:a", "aac", "-b:a", "96k", "-ar", "44100", "-ac", "2", str(part),
                ], check=True)
                parts.append(part)
            listing = Path(tmp) / "list.txt"
            listing.write_text("".join(f"file '{part.as_posix()}'\n" for part in parts))
            subprocess.run([
                ffmpeg, "-hide_banner", "-loglevel", "error", "-y", "-f", "concat", "-safe", "0",
                "-i", str(listing), "-c", "copy", "-movflags", "+faststart", str(out_dir / name),
            ], check=True)
        print(f"  {name}: {(out_dir / name).stat().st_size / 1e6:.1f} MB")


def main():
    parser = argparse.ArgumentParser()
    parser.add_argument("--ffmpeg", default=shutil.which("ffmpeg"))
    parser.add_argument("--skip-video", action="store_true")
    args = parser.parse_args()

    days = trajectory()
    voyage = {
        "launch": LAUNCH_UTC,
        "days": days,
        "asteroids": asteroids(),
        "callouts": landing_callouts(),
        "clips": {name: ranges for name, _, ranges in CLIPS},
    }
    path = ASSETS / "voyage.json"
    path.write_text(json.dumps(voyage, ensure_ascii=False, separators=(",", ":")), encoding="utf-8")
    print(f"voyage.json: {len(days)} days, path {days[-1]['pathKm'] / 1e6:.1f} million km")
    (ASSETS / "voyage").mkdir(parents=True, exist_ok=True)
    (ASSETS / "voyage" / "jezero-hazard-pia23970.jpg").write_bytes(fetch(HAZARD_MAP))

    if args.skip_video:
        return
    if not args.ffmpeg:
        raise SystemExit("ffmpeg not found; pass --ffmpeg PATH or --skip-video")
    cut_clips(args.ffmpeg, ASSETS / "voyage")


if __name__ == "__main__":
    main()
