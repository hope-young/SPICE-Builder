"""
loader_csv.py
============
从 CSV 文件（docs/CSV_FORMAT.md 格式）加载为 SimData
"""
from __future__ import annotations
import csv
import re
from pathlib import Path
from typing import Any
from .simdata import SimData


HEADER_ALIASES = {
    "vgsv": "vgs_v",
    "vgs": "vgs_v",
    "gatevoltage": "vgs_v",
    "gatevoltagev": "vgs_v",
    "vdsv": "vds_v",
    "vds": "vds_v",
    "drainvoltage": "vds_v",
    "drainvoltagev": "vds_v",
    "vsdv": "vsd_v",
    "vsd": "vsd_v",
    "sourcevoltage": "vsd_v",
    "sourcevoltagev": "vsd_v",
    "ida": "id_a",
    "id": "id_a",
    "draincurrent": "id_a",
    "draincurrenta": "id_a",
    "isa": "is_a",
    "is": "is_a",
    "sourcecurrent": "is_a",
    "sourcecurrenta": "is_a",
    "iga": "ig_a",
    "ig": "ig_a",
    "gatecurrent": "ig_a",
    "gatecurrenta": "ig_a",
    "temperaturec": "temperature_c",
    "tempc": "temperature_c",
    "tj": "temperature_c",
    "tjdc": "temperature_c",
    "cisspf": "ciss_pf",
    "ciss": "ciss_pf",
    "cosspf": "coss_pf",
    "coss": "coss_pf",
    "crsspf": "crss_pf",
    "crss": "crss_pf",
    "qgnc": "qg_nc",
    "qg": "qg_nc",
}


def _header_key(name: str) -> str:
    """Return the canonical internal column name for a CSV header."""
    stripped = name.strip().lstrip("\ufeff")
    compact = re.sub(r"[^0-9a-zA-Z]+", "", stripped).lower()
    return HEADER_ALIASES.get(compact, stripped.lower().replace(" ", "_"))


def _coerce_value(value: Any) -> Any:
    if value is None:
        return None
    text = str(value).strip()
    if text == "":
        return None
    try:
        num = float(text)
    except ValueError:
        return text
    return int(num) if num.is_integer() else num


def _read_csv(path: str | Path) -> tuple[list[dict], list[str], dict[str, str]]:
    path = Path(path)
    with open(path, newline="", encoding="utf-8-sig") as f:
        reader = csv.DictReader(f)
        if not reader.fieldnames:
            raise ValueError(f"CSV 缺少表头: {path}")

        canonical: dict[str, str] = {}
        for raw in reader.fieldnames:
            key = _header_key(raw)
            if key in canonical:
                raise ValueError(f"CSV 表头重复或别名冲突: {canonical[key]!r} 与 {raw!r}")
            canonical[key] = raw

        rows: list[dict] = []
        for line_no, row in enumerate(reader, start=2):
            if row.get(None):
                raise ValueError(f"第 {line_no} 行列数超过表头列数")
            normalized = {
                key: _coerce_value(row.get(raw_name))
                for key, raw_name in canonical.items()
            }
            if all(v is None for v in normalized.values()):
                continue
            rows.append(normalized)

    if not rows:
        raise ValueError(f"Empty CSV: {path}")
    return rows, list(canonical.keys()), canonical


def _require_columns(rows: list[dict], required: list[str], path: str | Path) -> None:
    columns = set(rows[0].keys()) if rows else set()
    missing = [c for c in required if c not in columns]
    if missing:
        got = ", ".join(sorted(columns))
        raise ValueError(f"{Path(path).name} 缺少必需列: {', '.join(missing)}; 当前列: {got}")


def _as_float(value: Any, column: str, path: str | Path) -> float:
    if value is None:
        raise ValueError(f"{Path(path).name} 列 {column} 存在空值")
    try:
        return float(value)
    except (TypeError, ValueError):
        raise ValueError(f"{Path(path).name} 列 {column} 不是数值: {value!r}") from None


def _normalize_numeric(rows: list[dict], columns: list[str], path: str | Path) -> None:
    for i, row in enumerate(rows, start=2):
        for col in columns:
            if col in row and row[col] is not None:
                try:
                    row[col] = float(row[col])
                except (TypeError, ValueError):
                    raise ValueError(f"{Path(path).name} 第 {i} 行列 {col} 不是数值: {row[col]!r}") from None


def _parse_bias_token(token: str) -> float | None:
    text = token.lower().replace("p", ".")
    if "." not in text and len(text) > 1 and text.startswith("0"):
        try:
            return float(f"0.{text[1:]}")
        except ValueError:
            return None
    try:
        return float(text)
    except ValueError:
        return None


def _infer_bias_from_filename(path: str | Path, key: str) -> float | None:
    stem = Path(path).stem.lower()
    match = re.search(rf"{key}\s*[_=-]?\s*([-+]?\d+(?:[p.]\d+)?(?:e[-+]?\d+)?)", stem)
    if not match:
        return None
    return _parse_bias_token(match.group(1))


def _first_value(rows: list[dict], column: str) -> Any:
    for row in rows:
        value = row.get(column)
        if value is not None:
            return value
    return None


def _fill_constant(rows: list[dict], column: str, value: float | int) -> None:
    for row in rows:
        if row.get(column) is None:
            row[column] = value


def _base_metadata(
    path: str | Path,
    columns: list[str],
    header_map: dict[str, str],
    inferred_fields: list[str],
) -> dict:
    return {
        "source_path": str(Path(path).resolve()),
        "source_file": Path(path).name,
        "columns": columns,
        "original_columns": header_map,
        "inferred_fields": inferred_fields,
    }


def load_idvg_csv(path: str | Path, temperature_c: int = 25) -> SimData:
    """CSV 列: vgs_v, id_a, vds_v, temperature_c"""
    rows, columns, header_map = _read_csv(path)
    _require_columns(rows, ["vgs_v", "id_a"], path)
    _normalize_numeric(rows, ["vgs_v", "id_a", "vds_v", "temperature_c"], path)

    inferred: list[str] = []
    if "temperature_c" not in columns:
        _fill_constant(rows, "temperature_c", temperature_c)
        inferred.append("temperature_c")

    vds_v = _first_value(rows, "vds_v")
    if vds_v is None:
        vds_v = _infer_bias_from_filename(path, "vds")
        if vds_v is None:
            raise ValueError(f"{Path(path).name} 缺少 vds_v，且无法从文件名推断 Vds")
        _fill_constant(rows, "vds_v", vds_v)
        inferred.append("vds_v")

    sd = SimData.from_idvg(rows, temperature_c=temperature_c, vds_v=float(vds_v))
    sd.metadata.update(_base_metadata(path, columns, header_map, inferred))
    return sd


def load_idvd_csv(path: str | Path, temperature_c: int = 25) -> SimData:
    """CSV 列: vds_v, id_a, vgs_v, temperature_c"""
    rows, columns, header_map = _read_csv(path)
    _require_columns(rows, ["vds_v", "id_a"], path)
    _normalize_numeric(rows, ["vds_v", "id_a", "vgs_v", "temperature_c"], path)

    inferred: list[str] = []
    if "temperature_c" not in columns:
        _fill_constant(rows, "temperature_c", temperature_c)
        inferred.append("temperature_c")

    vgs_v = _first_value(rows, "vgs_v")
    if vgs_v is None:
        vgs_v = _infer_bias_from_filename(path, "vgs")
        if vgs_v is None:
            raise ValueError(f"{Path(path).name} 缺少 vgs_v，且无法从文件名推断 Vgs")
        _fill_constant(rows, "vgs_v", vgs_v)
        inferred.append("vgs_v")

    sd = SimData.from_idvd(rows, vgs_v=float(vgs_v), temperature_c=temperature_c)
    sd.metadata.update(_base_metadata(path, columns, header_map, inferred))
    return sd


def _infer_bv_kind(path: str | Path, columns: list[str], rows: list[dict]) -> str:
    stem = Path(path).stem.lower()
    if "bvdss" in stem:
        return "bvdss"
    if "bvgss" in stem or "vgss" in stem:
        if any(tok in stem for tok in ("neg", "minus", "negative", "_n", "-n")) or "-" in stem:
            return "bvgss_n"
        return "bvgss_p"
    if "ig_a" in columns or "vgs_v" in columns:
        vals = [float(r["vgs_v"]) for r in rows if r.get("vgs_v") is not None]
        if vals and sum(vals) / len(vals) < 0:
            return "bvgss_n"
        return "bvgss_p"
    return "bvdss"


def load_bv_csv(path: str | Path, kind: str | None = None, temperature_c: int = 25) -> SimData:
    """CSV columns:

    - BVDSS:  vds_v, id_a, optional temperature_c
    - BVGSS:  vgs_v, ig_a, optional temperature_c
    """
    rows, columns, header_map = _read_csv(path)
    bv_kind = (kind or _infer_bv_kind(path, columns, rows)).lower()
    if bv_kind not in {"bvdss", "bvgss_p", "bvgss_n"}:
        raise ValueError(f"未知 BV 曲线类型: {bv_kind}")

    inferred: list[str] = []
    if bv_kind == "bvdss":
        _require_columns(rows, ["vds_v", "id_a"], path)
        _normalize_numeric(rows, ["vds_v", "id_a", "vgs_v", "temperature_c"], path)
        if "vgs_v" not in columns:
            _fill_constant(rows, "vgs_v", 0.0)
            inferred.append("vgs_v")
    else:
        _require_columns(rows, ["vgs_v", "ig_a"], path)
        _normalize_numeric(rows, ["vgs_v", "ig_a", "vds_v", "temperature_c"], path)
        if "vds_v" not in columns:
            _fill_constant(rows, "vds_v", 0.0)
            inferred.append("vds_v")

    if "temperature_c" not in columns:
        _fill_constant(rows, "temperature_c", temperature_c)
        inferred.append("temperature_c")

    sd = SimData.from_bv(rows, kind=bv_kind, temperature_c=temperature_c)
    sd.metadata.update(_base_metadata(path, columns, header_map, inferred))
    sd.metadata["bv_kind"] = bv_kind
    return sd


def load_cv_csv(path: str | Path, cap_type: str | None = None) -> SimData:
    """CSV 列: vds_v, ciss_pf, coss_pf, crss_pf"""
    rows, columns, header_map = _read_csv(path)
    _require_columns(rows, ["vds_v"], path)

    available = [c.replace("_pf", "") for c in ("ciss_pf", "coss_pf", "crss_pf") if c in columns]
    if not available:
        raise ValueError(f"{Path(path).name} 缺少电容列: ciss_pf/coss_pf/crss_pf")

    if cap_type is None:
        from_name = next((c for c in available if c in Path(path).stem.lower()), None)
        cap_type = from_name or available[0]
    if cap_type not in {"ciss", "coss", "crss"}:
        raise ValueError(f"未知 cap_type: {cap_type}; expected ciss|coss|crss")
    if f"{cap_type}_pf" not in columns:
        raise ValueError(f"{Path(path).name} 不包含 {cap_type}_pf 列")

    _normalize_numeric(rows, ["vds_v", "ciss_pf", "coss_pf", "crss_pf"], path)
    sd = SimData.from_cv(rows, cap_type=cap_type)
    sd.metadata.update(_base_metadata(path, columns, header_map, []))
    sd.metadata["available_cap_types"] = available
    return sd


def load_qg_csv(path: str | Path) -> SimData:
    """CSV 列: vgs_v, qg_nc, vds_v"""
    rows, columns, header_map = _read_csv(path)
    _require_columns(rows, ["vgs_v", "qg_nc"], path)
    _normalize_numeric(rows, ["vgs_v", "qg_nc", "vds_v"], path)

    inferred: list[str] = []
    vds_v = _first_value(rows, "vds_v")
    if vds_v is None:
        vds_v = _infer_bias_from_filename(path, "vds")
        if vds_v is None:
            raise ValueError(f"{Path(path).name} 缺少 vds_v，且无法从文件名推断 Vds")
        _fill_constant(rows, "vds_v", vds_v)
        inferred.append("vds_v")

    sd = SimData.from_qg(rows, vds_v=float(vds_v))
    sd.metadata.update(_base_metadata(path, columns, header_map, inferred))
    return sd


def load_body_diode_csv(path: str | Path, temperature_c: int = 25) -> SimData:
    """CSV 列: vsd_v, is_a, temperature_c, vgs_v"""
    rows, columns, header_map = _read_csv(path)
    _require_columns(rows, ["vsd_v", "is_a"], path)
    _normalize_numeric(rows, ["vsd_v", "is_a", "temperature_c", "vgs_v"], path)

    inferred: list[str] = []
    if "temperature_c" not in columns:
        _fill_constant(rows, "temperature_c", temperature_c)
        inferred.append("temperature_c")
    if "vgs_v" not in columns:
        _fill_constant(rows, "vgs_v", 0.0)
        inferred.append("vgs_v")

    sd = SimData.from_body_diode(rows, temperature_c=temperature_c)
    sd.metadata.update(_base_metadata(path, columns, header_map, inferred))
    sd.metadata["vgs_v"] = _as_float(_first_value(rows, "vgs_v"), "vgs_v", path)
    return sd
