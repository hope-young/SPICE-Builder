"""Tests for CSV curve loaders."""

import pytest

from spicebuilder.data.loader_csv import (
    load_body_diode_csv,
    load_cv_csv,
    load_idvg_csv,
    load_qg_csv,
)


def test_idvg_loader_infers_bias_and_default_temperature(tmp_path):
    path = tmp_path / "idvg_vds05.csv"
    path.write_text(
        "Vgs (V),Id (A)\n"
        "0,1e-9\n"
        "1,2e-6\n"
        "2,3e-3\n",
        encoding="utf-8",
    )

    sd = load_idvg_csv(path)

    assert sd.curve_type == "IdVg"
    assert sd.metadata["vds_v"] == pytest.approx(0.5)
    assert sd.metadata["temperature_c"] == 25
    assert sd.metadata["inferred_fields"] == ["temperature_c", "vds_v"]
    assert sd.ivar.tolist() == [0.0, 1.0, 2.0]


def test_cv_loader_detects_split_cap_type_from_file_name():
    sd = load_cv_csv("datademo/cleaned/cv_coss.csv")

    assert sd.curve_type == "CvVds"
    assert sd.metadata["cap_type"] == "coss"
    assert sd.metadata["available_cap_types"] == ["coss"]
    assert sd.n_points > 0


def test_qg_loader_creates_simdata(tmp_path):
    path = tmp_path / "qg_vds10.csv"
    path.write_text(
        "vgs_v,qg_nc\n"
        "0,0\n"
        "5,12.5\n"
        "10,30\n",
        encoding="utf-8",
    )

    sd = load_qg_csv(path)

    assert sd.curve_type == "Qg"
    assert sd.metadata["vds_v"] == 10.0
    assert sd.dvar.tolist() == [0.0, 12.5, 30.0]


def test_body_diode_loader_defaults_bias_columns(tmp_path):
    path = tmp_path / "body_diode.csv"
    path.write_text(
        "vsd_v,is_a\n"
        "0.0,1e-12\n"
        "0.7,1.5\n",
        encoding="utf-8",
    )

    sd = load_body_diode_csv(path)

    assert sd.curve_type == "IsVsd"
    assert sd.metadata["temperature_c"] == 25
    assert sd.metadata["vgs_v"] == 0.0
    assert sd.metadata["inferred_fields"] == ["temperature_c", "vgs_v"]


def test_loader_reports_missing_required_columns(tmp_path):
    path = tmp_path / "idvg_vds5.csv"
    path.write_text("vgs_v,current\n0,1e-9\n", encoding="utf-8")

    with pytest.raises(ValueError, match="缺少必需列: id_a"):
        load_idvg_csv(path)
