#!/usr/bin/env python3
"""Fetch the small, self-contained NASA dataset used by the rover game."""
from concurrent.futures import ThreadPoolExecutor
import csv
import io
import json
import math
from pathlib import Path
from urllib.request import urlopen
import xml.etree.ElementTree as ET

ASSETS = Path(__file__).resolve().parents[1] / "rover-replay" / "assets"
PHOTOS = "https://planetarydata.jpl.nasa.gov/img/data/mars2020/mars2020_navcam_ops_raw/browse/sol"
# PDS4 labels of the same raw products: local solar time, sun angles, temperatures, downlink time.
LABELS = "https://planetarydata.jpl.nasa.gov/img/data/mars2020/mars2020_navcam_ops_raw/data/sol"
TRAVERSE = "https://mars.nasa.gov/mmgis-maps/M20/Layers/json/M20_traverse.json"
PLACES = ("https://pds-geosciences.wustl.edu/m2020/"
          "urn-nasa-pds-mars2020_rover_places/data_localizations/best_interp.csv")
TILES = ("https://trek.nasa.gov/tiles/Mars/EQ/"
         "JEZ_hirise_soc_006_orthoMosaic_25cm_Eqc_latTs0_lon0_first_dd/1.0.0")
FRAMES = [
    (15, 386, "NLF_0015_0668287065_553ECM_N0030386NCAM03001_01_195J03.png"),
    (16, 548, "NLF_0016_0668366769_902ECM_N0030548NCAM00301_01_295J03.png"),
    (16, 578, "NLF_0016_0668369874_474ECM_N0030578NCAM00304_01_195J03.png"),
    (20, 704, "NLF_0020_0668725702_677ECM_N0030704NCAM00301_01_295J03.png"),
    (20, 740, "NLF_0020_0668725913_616ECM_N0030740NCAM00301_01_295J03.png"),
    (20, 770, "NLF_0020_0668728153_417ECM_N0030770NCAM00304_01_195J03.png"),
    (23, 792, "NLF_0023_0668989457_042ECM_N0030792NCAM03023_01_195J03.png"),
]


def fetch(url, limit=4_000_000):
    with urlopen(url, timeout=30) as response:
        data = response.read(limit + 1)
    if len(data) > limit:
        raise ValueError(f"Download exceeds limit: {url}")
    return data


SECONDS_PER_SOL = 88_775.244  # one Mars solar day in SI seconds (24 LMST hours)
ARM_JOINTS = ("AZIMUTH JOINT", "ELEVATION JOINT", "ELBOW JOINT", "WRIST JOINT", "TURRET JOINT")


def parse_label(data):
    """Read the environment of one Navcam image from its PDS4 label."""
    root = ET.fromstring(data)
    for node in root.iter():
        node.tag = node.tag.rsplit("}", 1)[-1]
    sun = None
    for geometry in root.iter("Derived_Geometry"):
        frame = geometry.findtext(".//local_identifier_reference") or ""
        if frame.startswith("SITE_FRAME"):  # north-referenced, local level
            sun = (float(geometry.findtext("solar_elevation")),
                   float(geometry.findtext("solar_azimuth")))
    temperatures = {}
    for index in root.iter("Device_Temperature_Index"):
        temperatures[index.findtext("index_id")] = float(index.findtext("index_value_temperature"))
    if sun is None or "NAVCAM LEFT CAMERA PLATE" not in temperatures:
        raise ValueError("Label lacks site-frame sun angles or Navcam temperature")
    return {
        "utc": root.findtext(".//start_date_time"),
        "earthReceived": root.findtext(".//earth_received_start_date_time"),
        "lmst": root.findtext(".//local_mean_solar_time"),
        "ltst": root.findtext(".//local_true_solar_time"),
        "sunElevation": sun[0],
        "sunAzimuth": sun[1],
        "navcamTempC": temperatures["NAVCAM LEFT CAMERA PLATE"],
        "armTempC": {name: temperatures[name] for name in ARM_JOINTS if name in temperatures},
    }


def clock_seconds(text):
    hours, minutes, seconds = text.split(":")
    return int(hours) * 3600 + int(minutes) * 60 + float(seconds)


def clock_text(seconds):
    seconds = round(seconds) % 86_400
    return f"{seconds // 3600:02}:{seconds // 60 % 60:02}:{seconds % 60:02}"


def save_png(entry):
    url, name = entry
    path = ASSETS / name
    if path.exists() and path.read_bytes().startswith(b"\x89PNG\r\n\x1a\n"):
        return
    data = fetch(url)
    if not data.startswith(b"\x89PNG\r\n\x1a\n"):
        raise ValueError(f"Expected PNG: {url}")
    path.write_bytes(data)


def main():
    ASSETS.mkdir(parents=True, exist_ok=True)
    with ThreadPoolExecutor() as pool:
        line_request = pool.submit(fetch, TRAVERSE)
        wmts_request = pool.submit(fetch, TILES + "/WMTSCapabilities.xml")
        places_request = pool.submit(fetch, PLACES, 12_000_000)
        traverse = json.loads(line_request.result())
        wmts = ET.fromstring(wmts_request.result())
        places = list(csv.DictReader(io.StringIO(places_request.result().decode("ascii"))))

    # Both the JPL traverse coordinates and this WMTS grid use longitude/latitude.
    matrix_set = wmts.find(".//{*}Contents/{*}TileMatrixSet")
    scheme = matrix_set.findtext("{*}Identifier")
    matrix = next(m for m in matrix_set.findall("{*}TileMatrix")
                  if m.findtext("{*}Identifier") == "17")
    west, north = map(float, matrix.findtext("{*}TopLeftCorner").split())
    size = int(matrix.findtext("{*}TileWidth"))
    degrees_per_pixel = 360 / (float(matrix.findtext("{*}MatrixWidth")) * size)

    def project(lon, lat):
        return ((lon - west) / degrees_per_pixel, (north - lat) / degrees_per_pixel)

    segments = []
    for first, last in [(386, 578), (578, 770), (770, 792)]:
        feature = next(f for f in traverse["features"]
                       if f["properties"]["fromRMC"] == f"3_{first}"
                       and f["properties"]["toRMC"] == f"3_{last}")
        segments.append([project(*coordinate[:2]) for coordinate in feature["geometry"]["coordinates"]])

    path = []
    intervals = []
    for segment in segments:
        start = max(0, len(path) - 1)
        path.extend(segment if not path else segment[1:])
        intervals.append(range(start, len(path) - 1))

    center_lat = 18.445
    longitude_scale = math.cos(math.radians(center_lat))
    metres_per_pixel_y = degrees_per_pixel * math.pi / 180 * 3_396_190

    def metric(point):
        return point[0] * longitude_scale, point[1]

    distance = [0]
    for a, b in zip(path, path[1:]):
        distance.append(distance[-1] + math.dist(metric(a), metric(b)))

    def nearest(point, indices):
        px, py = metric(point)
        nearest_error, best_distance = math.inf, 0
        for i in indices:
            ax, ay = metric(path[i])
            bx, by = metric(path[i+1])
            dx, dy = bx-ax, by-ay
            if not (dx or dy):
                continue
            t = min(1, max(0, ((px-ax)*dx + (py-ay)*dy) / (dx*dx + dy*dy)))
            error = math.hypot(px-ax-t*dx, py-ay-t*dy)
            if error < nearest_error:
                nearest_error = error
                best_distance = distance[i] + t * (distance[i+1] - distance[i])
        return best_distance, nearest_error * metres_per_pixel_y

    min_x, max_x = min(p[0] for p in path), max(p[0] for p in path)
    min_y, max_y = min(p[1] for p in path), max(p[1] for p in path)
    left, top = math.floor(min_x - 34), math.floor(min_y - 42)
    width, height = math.ceil(max_x + 34 - left), math.ceil(max_y + 42 - top)

    def local(p):
        return [round(p[0] - left, 3), round(p[1] - top, 3)]

    tiles = []
    for row in range(top // size, (top + height) // size + 1):
        for col in range(left // size, (left + width) // size + 1):
            name = f"hirise-{row}-{col}.png"
            tiles.append({"name": name, "x": col*size-left, "y": row*size-top, "size": size,
                          "url": f"{TILES}/default/{scheme}/17/{row}/{col}.png"})

    frames = []
    for index, (sol, drive, name) in enumerate(FRAMES):
        fields = name.split("_")
        sclk = float(f"{fields[2]}.{fields[3][:3]}")
        rows = [row for row in places if row["frame"] == "ROVER" and row["site"] == "3"
                and int(row["drive"]) == drive]
        row = min(rows, key=lambda record: abs(float(record["sclk"]) - sclk))
        lon, lat = float(row["longitude"]), float(row["planetocentric_latitude"])
        segment = 0 if drive <= 578 else 1 if drive <= 770 else 2
        at, offset = nearest(project(lon, lat), intervals[segment])
        frames.append({
            "name": name, "url": f"{PHOTOS}/{sol:05}/ids/edr/ncam/{name}",
            "sol": sol, "drive": drive, "sclk": sclk, "at": index * 6,
            "positionSclk": int(row["sclk"]), "lon": lon, "lat": lat,
            "distance": round(at * metres_per_pixel_y, 3),
            "routeOffsetM": round(offset, 3),
        })

    if any(a["sclk"] >= b["sclk"] or a["distance"] >= b["distance"]
           for a, b in zip(frames, frames[1:])):
        raise ValueError("Frames must advance in capture time and route distance")

    # Environment at each image, from the image's own PDS4 label.
    label_urls = [f"{LABELS}/{sol:05}/ids/edr/ncam/{name[:-4]}.xml" for sol, _, name in FRAMES]
    with ThreadPoolExecutor(max_workers=6) as pool:
        labels = [parse_label(data) for data in pool.map(fetch, label_urls)]
    for frame, env, url in zip(frames, labels, label_urls):
        frame["env"] = env
        frame["labelUrl"] = url

    def lmst_at(sol, sclk):
        # SCLK counts SI seconds; convert the offset from an image of the same sol to LMST.
        ref = next(f for f in frames if f["sol"] == sol)
        offset = (sclk - ref["sclk"]) * 86_400 / SECONDS_PER_SOL
        return clock_text(clock_seconds(ref["env"]["lmst"]) + offset)

    # Rover attitude at every traverse vertex. The JPL traverse is drawn through the PLACES
    # drive positions, so the two lists must line up one to one; stop if they do not.
    poses = sorted((row for row in places if row["frame"] == "ROVER" and row["site"] == "3"
                    and FRAMES[0][1] <= int(row["drive"]) <= FRAMES[-1][1]),
                   key=lambda row: int(row["drive"]))
    if len(poses) != len(path):
        raise ValueError(f"PLACES has {len(poses)} poses but the traverse has {len(path)} vertices")
    worst = max(math.dist(metric(p), metric(project(float(r["longitude"]),
                                                    float(r["planetocentric_latitude"]))))
                for p, r in zip(path, poses)) * metres_per_pixel_y
    if worst > 0.5:
        raise ValueError(f"PLACES poses are {worst:.2f} m away from the traverse vertices")
    base_elevation = float(poses[0]["elevation"])
    pose_data = [{
        "drive": int(r["drive"]), "sol": int(r["sol"]), "sclk": int(r["sclk"]),
        "lmst": lmst_at(int(r["sol"]), int(r["sclk"])),
        "pitch": float(r["pitch"]), "roll": float(r["roll"]), "yaw": float(r["yaw"]),
        "elevationM": round(float(r["elevation"]) - base_elevation, 3),
    } for r in poses]

    # One entry per sol of driving: the rows after the first image's drive up to the next image.
    drives = []
    for first, last in [(386, 578), (578, 770), (770, 792)]:
        rows = [p for p, d in zip(pose_data, distance) if first < p["drive"] <= last]
        moved = [d for p, d in zip(pose_data, distance) if first <= p["drive"] <= last]
        steepest = max(rows, key=lambda p: max(abs(p["pitch"]), abs(p["roll"])))
        drives.append({
            "fromDrive": first, "toDrive": last, "sol": rows[0]["sol"],
            "startSclk": rows[0]["sclk"], "endSclk": rows[-1]["sclk"],
            "startLmst": rows[0]["lmst"], "endLmst": rows[-1]["lmst"],
            "lengthM": round((moved[-1] - moved[0]) * metres_per_pixel_y, 3),
            "climbM": round(rows[-1]["elevationM"] - next(
                p["elevationM"] for p in pose_data if p["drive"] == first), 3),
            "steepest": {"drive": steepest["drive"], "pitch": steepest["pitch"],
                         "roll": steepest["roll"]},
        })
    with ThreadPoolExecutor(max_workers=6) as pool:
        list(pool.map(save_png, [(a["url"], a["name"]) for a in frames + tiles]))

    data = {"frames": frames, "tiles": tiles, "width": width, "height": height,
            "scale20m": round(20 / (metres_per_pixel_y * longitude_scale), 3),
            "route": [local(p) + [round(d * metres_per_pixel_y, 3)] for p, d in zip(path, distance)],
            "poses": pose_data, "drives": drives,
            "sources": {"traverse": TRAVERSE, "places": PLACES, "wmts": TILES + "/WMTSCapabilities.xml",
                        "labels": LABELS}}
    (ASSETS / "mission.json").write_text(json.dumps(data, indent=2) + "\n")
    print(f"Saved {len(frames)} Navcam images, {len(tiles)} HiRISE tiles, and {len(path)} traverse vertices.")


if __name__ == "__main__":
    main()
