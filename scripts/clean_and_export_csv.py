#!/usr/bin/env python3
"""清洗 Excel 数据并导出为独立 CSV 文件（按曲线类型分开）"""
import csv
from pathlib import Path
from spicebuilder.data.loader_sdh import load_sdh_excel

SRC = "datademo/SDH10N2P1WC-AA_SPICE_Data.xlsx"
OUT = Path("datademo/cleaned")
OUT.mkdir(exist_ok=True)

ds = load_sdh_excel(SRC)
print(f"Loaded: {ds.device_info.part_number}")


def to_float(val, default=0.0):
    try:
        return float(val)
    except (TypeError, ValueError):
        return default


def save_csv(path, rows, cols):
    if not rows:
        print(f"  SKIP {path.name} - no data")
        return
    rows_sorted = sorted(rows, key=lambda r: to_float(r.get(cols[0], 0)))
    with open(path, "w", newline="", encoding="utf-8") as f:
        w = csv.DictWriter(f, fieldnames=cols, extrasaction="ignore")
        w.writeheader()
        w.writerows(rows_sorted)
    print(f"  OK {path.name} - {len(rows_sorted)} rows")


# ---- Id-Vg @ Vds=5V (25C only) ----
print("\nIdVg Vds=5V:")
rows5 = [p for p in ds.idvg_vds5 if to_float(p.get("temperature_c", 25)) == 25]
save_csv(OUT / "idvg_vds5.csv", rows5, ["vgs_v", "id_a", "vds_v", "temperature_c"])

# ---- Id-Vg @ Vds=0.5V (25C only) ----
print("\nIdVg Vds=0.5V:")
rows05 = [p for p in ds.idvg_vds05 if to_float(p.get("temperature_c", 25)) == 25]
save_csv(OUT / "idvg_vds05.csv", rows05, ["vgs_v", "id_a", "vds_v", "temperature_c"])

# ---- Id-Vd (25C only, grouped by Vgs) ----
print("\nIdVd:")
rows_idvd = [p for p in ds.idvd if to_float(p.get("temperature_c", 25)) == 25]
vgs_vals = sorted(set(to_float(p.get("vgs_v", 0)) for p in rows_idvd))
for vgs in vgs_vals:
    sub = [p for p in rows_idvd if to_float(p.get("vgs_v", 0)) == vgs]
    fname = f"idvd_vgs{vgs:.1f}.csv"
    save_csv(OUT / fname, sub, ["vds_v", "id_a", "vgs_v", "temperature_c"])

# ---- C-V ----
print("\nCV:")
rows_cv = sorted(ds.cv_vds, key=lambda r: to_float(r.get("vds_v", 0)))
save_csv(OUT / "cv.csv", rows_cv, ["vds_v", "ciss_pf", "coss_pf", "crss_pf"])

ciss_out = [{"vds_v": to_float(r.get("vds_v", 0)), "ciss_pf": to_float(r.get("ciss_pf", 0))} for r in rows_cv]
coss_out = [{"vds_v": to_float(r.get("vds_v", 0)), "coss_pf": to_float(r.get("coss_pf", 0))} for r in rows_cv]
crss_out = [{"vds_v": to_float(r.get("vds_v", 0)), "crss_pf": to_float(r.get("crss_pf", 0))} for r in rows_cv]
save_csv(OUT / "cv_ciss.csv", ciss_out, ["vds_v", "ciss_pf"])
save_csv(OUT / "cv_coss.csv", coss_out, ["vds_v", "coss_pf"])
save_csv(OUT / "cv_crss.csv", crss_out, ["vds_v", "crss_pf"])

# ---- Body Diode (25C only) ----
print("\nBodyDiode:")
rows_bd = [p for p in ds.body_diode if to_float(p.get("temperature_c", 25)) == 25]
save_csv(OUT / "body_diode.csv", rows_bd, ["vsd_v", "is_a", "temperature_c", "vgs_v"])

print(f"\nAll files in: {OUT.resolve()}")
