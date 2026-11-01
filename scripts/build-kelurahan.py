"""
Membuat data/kelurahan/*.js: daftar kelurahan/desa Indonesia beserta titik tengahnya.
Dipakai main.js untuk mengubah koordinat (GPS / hasil pencarian) menjadi kode kelurahan
(adm4) yang dibutuhkan API prakiraan cuaca BMKG.

Sumber: https://github.com/cahyadsn/wilayah_boundaries (lisensi MIT)

Pemakaian (butuh git + internet, mengunduh ±340 MB sekali):
    python scripts/build-kelurahan.py
atau, kalau repo sumber sudah di-clone:
    python scripts/build-kelurahan.py path/ke/wilayah_boundaries
"""

import json
import re
import shutil
import subprocess
import sys
import tempfile
from pathlib import Path

REPO_URL = "https://github.com/cahyadsn/wilayah_boundaries.git"
OUT = Path(__file__).resolve().parent.parent / "data" / "kelurahan"

# ('31.71.03.1001','Kemayoran',-6.1647,106.8453,'[[[...poligon...]]]')
ROW = re.compile(
    r"\('(\d{2}\.\d{2}\.\d{2}\.\d{4})','((?:[^'\\]|\\.|'')*)',"
    r"(-?\d+(?:\.\d+)?),(-?\d+(?:\.\d+)?),"
)


def clone(dest):
    """Clone dangkal yang hanya mengambil folder db/kel."""
    run = lambda *args: subprocess.run(["git", *args], check=True)
    run("clone", "--depth", "1", "--filter=blob:none", "--sparse", "-q", REPO_URL, str(dest))
    run("-C", str(dest), "sparse-checkout", "set", "db/kel")


def parse_sql(text):
    rows = []
    for kode, nama, lat, lng in ROW.findall(text):
        nama = nama.replace("''", "'").replace("\\'", "'")
        rows.append([kode, nama, round(float(lat), 4), round(float(lng), 4)])
    return rows


def build(source):
    kel_dir = source / "db" / "kel"
    provinces = sorted(p for p in kel_dir.iterdir() if p.is_dir())
    if not provinces:
        sys.exit(f"Tidak ada folder provinsi di {kel_dir}")

    OUT.mkdir(parents=True, exist_ok=True)
    index = {}
    total = 0
    for prov_dir in provinces:
        prov = prov_dir.name
        rows = []
        for sql in sorted(prov_dir.glob("*.sql")):
            rows += parse_sql(sql.read_text(encoding="utf-8"))
        if not rows:
            print(f"  {prov}: KOSONG", file=sys.stderr)
            continue
        rows.sort(key=lambda r: r[0])

        lats = [r[2] for r in rows]
        lngs = [r[3] for r in rows]
        index[prov] = [min(lats), max(lats), min(lngs), max(lngs)]
        body = json.dumps(rows, ensure_ascii=False, separators=(",", ":"))
        (OUT / f"{prov}.js").write_text(
            "window.KELURAHAN_DATA = window.KELURAHAN_DATA || {};\n"
            f'window.KELURAHAN_DATA["{prov}"] = {body};\n',
            encoding="utf-8",
        )
        total += len(rows)
        print(f"  {prov}: {len(rows)} kelurahan")

    (OUT / "index.js").write_text(
        "// Batas koordinat tiap provinsi: [minLat, maxLat, minLng, maxLng]\n"
        f"window.KELURAHAN_INDEX = {json.dumps(index, separators=(',', ':'))};\n",
        encoding="utf-8",
    )
    license_file = source / "LICENSE"
    if license_file.exists():
        shutil.copy(license_file, OUT / "LICENSE")
    print(f"Total {total} kelurahan, {len(index)} provinsi -> {OUT}")


def main():
    if len(sys.argv) > 1:
        build(Path(sys.argv[1]))
        return
    with tempfile.TemporaryDirectory() as tmp:
        dest = Path(tmp) / "wilayah_boundaries"
        clone(dest)
        build(dest)


if __name__ == "__main__":
    main()
