#!/usr/bin/env python3
"""Download one Perseverance observation and verify its camera-to-XYZ alignment."""
import argparse
import base64
import csv
import io
import json
import math
from pathlib import Path
import statistics
import struct
from urllib.request import urlopen
import xml.etree.ElementTree as ET
import zlib

ARCHIVE = "https://planetarydata.jpl.nasa.gov/img/data/mars2020/mars2020_navcam_ops_"
PREFIX = "NLF_0016_0668366769"
SUFFIX = "N0030548NCAM00301_0A0295J"
IMAGE = ARCHIVE + f"calibrated/data/sol/00016/ids/rdr/ncam/{PREFIX}_902RASL{SUFFIX}02"
XYZ = ARCHIVE + f"stereo/data/sol/00016/ids/rdr/ncam/{PREFIX}_902XYZL{SUFFIX}04"
MESH = ARCHIVE + f"mesh/data/sol/00016/ids/rdr/mesh/{PREFIX}M902RAS_{SUFFIX}02.obj.xml"
PLACES = ("https://pds-geosciences.wustl.edu/m2020/"
          "urn-nasa-pds-mars2020_rover_places/data_localizations/best_interp.csv")


def download(url, directory):
    path = directory / url.rsplit("/", 1)[-1]
    if not path.exists():
        with urlopen(url, timeout=30) as response:
            contents = response.read(20_000_001)
        if len(contents) > 20_000_000:
            raise ValueError(f"Download exceeded sample limit: {url}")
        path.write_bytes(contents)
    return path


def label(path):
    root = ET.parse(path).getroot()
    for node in root.iter():
        node.tag = node.tag.rsplit("}", 1)[-1]
    return root


def values(node):
    return tuple(float(child.text) for child in node)


def read_image(root, path, data_type, type_code):
    raster = root.find(".//Array_3D_Image")
    axes = [(axis.findtext("axis_name"), int(axis.findtext("elements")))
            for axis in raster.findall("Axis_Array")]
    if ([axis[0] for axis in axes] != ["Band", "Line", "Sample"] or axes[0][1] != 3
            or raster.findtext("axis_index_order") != "Last Index Fastest"
            or raster.findtext("Element_Array/data_type") != data_type
            or root.findtext(".//File/file_name") != path.name):
        raise ValueError(f"Unexpected raster layout: {path.name}")
    _, (_, height), (_, width) = axes
    contents = path.read_bytes()
    offset = int(raster.findtext("offset"))
    size = struct.calcsize(">" + type_code)
    if len(contents) != offset + 3 * width * height * size:
        raise ValueError(f"Unexpected raster size: {path.name}")

    def pixel(x, y):
        index = y * width + x
        return tuple(struct.unpack_from(">" + type_code, contents,
                                        offset + (index + band * width * height) * size)[0]
                     for band in range(3))

    return width, height, pixel


def dot(a, b):
    return sum(x * y for x, y in zip(a, b))


def rotation(q):
    w, x, y, z = (v / math.hypot(*q) for v in q)
    return ((1 - 2*(y*y + z*z), 2*(x*y - w*z), 2*(x*z + w*y)),
            (2*(x*y + w*z), 1 - 2*(x*x + z*z), 2*(y*z - w*x)),
            (2*(x*z - w*y), 2*(y*z + w*x), 1 - 2*(x*x + y*y)))


def find_places(output, rmc, clock):
    path = output / "places_sol16.csv"
    if not path.exists():
        with urlopen(PLACES, timeout=30) as response:
            # This observation is near the start of the archive. Bound transfer size.
            prefix = response.read(2_000_000).decode("ascii")
        reader = csv.DictReader(io.StringIO(prefix.rsplit("\n", 1)[0]))
        rows = [row for row in reader if row["site"] == rmc["site"]
                and (row["frame"] == "SITE" or row["drive"] == rmc["drive"])]
        if not any(row["frame"] == "ROVER" for row in rows):
            raise ValueError("Matching ROVER row absent from PLACES sample")
        with path.open("w", newline="") as stream:
            writer = csv.DictWriter(stream, fieldnames=reader.fieldnames)
            writer.writeheader()
            writer.writerows(rows)
    with path.open(newline="") as stream:
        rows = list(csv.DictReader(stream))
    rover = min((row for row in rows if row["frame"] == "ROVER"),
                key=lambda row: abs(float(row["sclk"]) - clock))
    poses = [row for row in rows if row["frame"] == "POSE" and row["pose"] == rmc["pose"]]
    return rover, poses


def png(width, height, pixel):
    # Display stretch only. Keep the calibrated source IMG unchanged.
    levels = sorted(value for y in range(0, height, 8) for x in range(0, width, 8)
                    for value in pixel(x, y) if value > 0)
    low, high = levels[len(levels)//50], levels[len(levels)*49//50]
    raster = bytearray()
    for y in range(height):
        raster.append(0)
        for x in range(width):
            raster.extend(min(255, max(0, round((v - low) * 255 / (high - low))))
                          for v in pixel(x, y))

    def chunk(tag, data):
        return (struct.pack(">I", len(data)) + tag + data
                + struct.pack(">I", zlib.crc32(tag + data)))

    return (b"\x89PNG\r\n\x1a\n"
            + chunk(b"IHDR", struct.pack(">IIBBBBB", width, height, 8, 2, 0, 0, 0))
            + chunk(b"IDAT", zlib.compress(raster))
            + chunk(b"IEND", b""))


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--output", type=Path, default=Path("navcam-sample"))
    output = parser.parse_args().output
    output.mkdir(parents=True, exist_ok=True)
    urls = [IMAGE + ".xml", IMAGE + ".IMG", XYZ + ".xml", XYZ + ".IMG", MESH]
    image_xml, image_file, xyz_xml, xyz_file, mesh_xml = [
        download(url, output) for url in urls]
    image, xyz, mesh = map(label, (image_xml, xyz_xml, mesh_xml))
    rmc = {node.findtext("index_id").lower(): node.findtext("index_value_number")
           for node in image.findall(".//Motion_Counter/Motion_Counter_Index")}
    clock = float(image.findtext(".//spacecraft_clock_start"))
    if (image.findtext(".//start_date_time") != xyz.findtext(".//start_date_time")
            or image.findtext(".//spacecraft_clock_start") != xyz.findtext(".//spacecraft_clock_start")):
        raise ValueError("Observation timestamps differ")
    image_product = image.findtext("./Identification_Area/logical_identifier").rsplit(":", 1)[-1]
    stereo_inputs = [node.text.lower() for node in xyz.findall(".//value") if node.text]
    # PDS Stereo processing history names the actual linearized VICAR source.
    image_input = image_file.with_suffix(".VIC").name.lower()
    if image_input not in stereo_inputs:
        raise ValueError("XYZ processing history does not name the selected image")
    image_camera = image.find(".//Camera_Model_Parameters")
    xyz_camera = xyz.find(".//Camera_Model_Parameters")
    if (image_camera.findtext("model_type") != "CAHV"
            or ET.tostring(image_camera) != ET.tostring(xyz_camera)):
        raise ValueError("Camera models differ or are unsupported")
    camera = image_camera.find("CAHV_Model")
    center, axis, horizontal, vertical = map(values, camera)
    derived_frame = xyz.findtext(".//Derived_Product_Parameters//local_identifier_reference")
    camera_frame = image_camera.find(".//Coordinate_Space_Indexed")
    frame_prefix = "_".join([camera_frame.findtext("coordinate_space_frame_type")] + [
        index.findtext("index_value_number") for index in camera_frame.findall("Coordinate_Space_Index")
    ])
    rover_frame = next(node for node in xyz.findall(".//Coordinate_Space_Definition")
                       if node.findtext("local_identifier", "").startswith(frame_prefix + "_"))
    if (rover_frame.findtext("Coordinate_Space_Reference//local_identifier_reference") != derived_frame
            or rover_frame.findtext("Quaternion_Plus_Direction/rotation_direction") != "Forward"):
        raise ValueError("Unexpected frame transformation")
    origin = values(rover_frame.find("Vector_Origin_Offset"))
    quaternion = tuple(float(rover_frame.findtext("Quaternion_Plus_Direction/" + name))
                       for name in ("qcos", "qsin1", "qsin2", "qsin3"))
    matrix = rotation(quaternion)
    inverse = tuple(zip(*matrix))

    def project(point):
        relative = tuple(p - o for p, o in zip(point, origin))
        rover_point = tuple(dot(row, relative) for row in inverse)
        ray = tuple(p - c for p, c in zip(rover_point, center))
        depth = dot(ray, axis)
        if depth <= 0:
            return None
        return dot(ray, horizontal) / depth, dot(ray, vertical) / depth

    width, height, image_pixel = read_image(image, image_file, "SignedMSB2", "h")
    xsize, ysize, xyz_pixel = read_image(xyz, xyz_file, "IEEE754MSBSingle", "f")
    if (width, height) != (xsize, ysize):
        raise ValueError("Image and XYZ dimensions differ")
    errors, probes = [], []
    behind = 0
    for y in range(0, height, 8):
        for x in range(0, width, 8):
            point = xyz_pixel(x, y)
            if not any(point) or not all(map(math.isfinite, point)):
                continue
            uv = project(point)
            if uv is None:
                behind += 1
                continue
            errors.append(math.dist((x, y), uv))
            if x % 64 == 0 and y % 64 == 0:
                probes.append(uv)
    if not errors:
        raise ValueError("No valid XYZ samples projected")
    rover, poses = find_places(output, rmc, clock)
    report = {
        "download_urls": urls, "places_url": PLACES,
        "utc": image.findtext(".//start_date_time"), "sclk": clock,
        "sol": int(image.findtext(".//start_sol_number")),
        "rmc": {key: rmc[key] for key in ("site", "drive", "pose")},
        "image_product": image_product, "stereo_input_image": image_input,
        "image_size": [width, height], "xyz_frame": derived_frame,
        "camera_frame": image_camera.findtext(".//coordinate_space_frame_type"),
        "camera_cahv": dict(zip("CAHV", (center, axis, horizontal, vertical))),
        "camera_center_site_m": [dot(row, center) + value for row, value in zip(matrix, origin)],
        "camera_axis_site": [dot(row, axis) for row in matrix],
        "rover_to_site_m": origin, "rover_to_site_quaternion_wxyz": quaternion,
        "mesh_label_source_products": [node.findtext("lidvid_reference")
                                       for node in mesh.findall(".//Source_Product_Internal")],
        "mesh_frame": mesh.findtext(".//Derived_Product_Parameters//coordinate_space_frame_type"),
        "mesh_site": mesh.findtext(".//Derived_Product_Parameters//index_value_number"),
        "mesh_payload_urls": [MESH.rsplit("/", 1)[0] + "/" + node.text
                              for node in mesh.findall(".//File/file_name")],
        "places_rover_row": rover,
        "places_rover_row_sclk_offset_s": float(rover["sclk"]) - clock,
        "places_exact_rmc_pose_rows": poses,
        "reprojection": {"sample_stride": 8, "projected_count": len(errors), "behind": behind,
                         "median_px": statistics.median(errors),
                         "p95_px": statistics.quantiles(errors, n=100)[94],
                         "max_px": max(errors)},
    }
    (output / "report.json").write_text(json.dumps(report, indent=2) + "\n")
    image_bytes = png(width, height, image_pixel)
    (output / "navcam.png").write_bytes(image_bytes)
    dots = "".join(f'<circle cx="{x:.3f}" cy="{y:.3f}" r="3"/>' for x, y in probes)
    encoded = base64.b64encode(image_bytes).decode("ascii")
    (output / "reprojection.svg").write_text(
        f'<svg xmlns="http://www.w3.org/2000/svg" width="{width}" height="{height}" '
        f'viewBox="-0.5 -0.5 {width} {height}">'
        '<title>Perseverance Sol 16: projected XYZ samples on left Navcam image</title>'
        f'<image x="-0.5" y="-0.5" width="{width}" height="{height}" href="data:image/png;base64,{encoded}"/>'
        f'<g fill="#72ffdc" stroke="#143831" stroke-width="1">{dots}</g></svg>\n')
    print(json.dumps(report, indent=2))
    if behind or report["reprojection"]["p95_px"] > 0.25:
        raise SystemExit("Reprojection failed the sample acceptance threshold")


if __name__ == "__main__":
    main()
