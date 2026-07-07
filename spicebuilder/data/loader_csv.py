"""
loader_csv.py
============
从 CSV 文件（docs/CSV_FORMAT.md 格式）加载为 SimData
"""
from __future__ import annotations
import csv
from pathlib import Path
from .simdata import SimData


def _normalize(rows: list[dict]) -> list[dict]:
    """把 CSV 字典的值全部转为适当的 Python 类型（int/float/str）"""
    result = []
    for row in rows:
        r = {}
        for k, v in row.items():
            if v is None or v == "":
                r[k] = None
            else:
                try:
                    r[k] = int(v)
                except ValueError:
                    try:
                        r[k] = float(v)
                    except ValueError:
                        r[k] = v.strip()
        result.append(r)
    return result


def _read_csv(path: str | Path) -> list[dict]:
    with open(path, newline="", encoding="utf-8") as f:
        rows = list(csv.DictReader(f))
    return _normalize(rows)


def load_idvg_csv(path: str | Path, temperature_c: int = 25) -> SimData:
    """CSV 列: vgs_v, id_a, vds_v, temperature_c"""
    rows = _read_csv(path)
    if not rows:
        raise ValueError(f"Empty CSV: {path}")
    vds_v = rows[0]["vds_v"]
    return SimData.from_idvg(rows, temperature_c=temperature_c, vds_v=vds_v)


def load_idvd_csv(path: str | Path, temperature_c: int = 25) -> SimData:
    """CSV 列: vds_v, id_a, vgs_v, temperature_c"""
    rows = _read_csv(path)
    if not rows:
        raise ValueError(f"Empty CSV: {path}")
    vgs_v = rows[0]["vgs_v"]
    return SimData.from_idvd(rows, vgs_v=vgs_v, temperature_c=temperature_c)


def load_cv_csv(path: str | Path) -> SimData:
    """CSV 列: vds_v, ciss_pf, coss_pf, crss_pf"""
    rows = _read_csv(path)
    if not rows:
        raise ValueError(f"Empty CSV: {path}")
    return SimData.from_cv(rows, cap_type="ciss")


def load_qg_csv(path: str | Path) -> SimData:
    """CSV 列: vgs_v, qg_nc, vds_v"""
    rows = _read_csv(path)
    if not rows:
        raise ValueError(f"Empty CSV: {path}")
    vds_v = rows[0]["vds_v"]
    return SimData.from_qg(rows, vds_v=vds_v)


def load_body_diode_csv(path: str | Path, temperature_c: int = 25) -> SimData:
    """CSV 列: vsd_v, is_a, temperature_c, vgs_v"""
    rows = _read_csv(path)
    if not rows:
        raise ValueError(f"Empty CSV: {path}")
    return SimData.from_body_diode(rows, temperature_c=temperature_c)
