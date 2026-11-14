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
    with ThreadPoolExecutor(max_workers=6) as pool:
        list(pool.map(save_png, [(a["url"], a["name"]) for a in frames + tiles]))

    data = {"frames": frames, "tiles": tiles, "width": width, "height": height,
            "scale20m": round(20 / (metres_per_pixel_y * longitude_scale), 3),
            "route": [local(p) + [round(d * metres_per_pixel_y, 3)] for p, d in zip(path, distance)],
            "sources": {"traverse": TRAVERSE, "places": PLACES, "wmts": TILES + "/WMTSCapabilities.xml"}}
    (ASSETS / "mission.json").write_text(json.dumps(data, indent=2) + "\n")
    print(f"Saved {len(frames)} Navcam images, {len(tiles)} HiRISE tiles, and {len(path)} traverse vertices.")


if __name__ == "__main__":
    main()
