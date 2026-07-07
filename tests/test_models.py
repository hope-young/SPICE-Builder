"""Tests for the BSIM3 model layer."""

from spicebuilder.data.loader_sdh import load_sdh_excel
from spicebuilder.models import BSIM3Model, LibExporter, init_from_key_params
from spicebuilder.models.bsim3 import PARAM_SPECS


def test_default_model_and_dot_path_access():
    model = BSIM3Model(name="nmos1")

    assert model.get("VTH0") == 3.0
    assert model.get("nmos1.VTH0") == 3.0
    assert model.get("U0") == 450.0
    assert len(model.to_dict()) == len(PARAM_SPECS)


def test_bounds_fitted_flag_and_reset():
    model = BSIM3Model(name="nmos1")

    try:
        model.set("VTH0", 100)
        raise AssertionError("setting VTH0 outside bounds should fail")
    except ValueError:
        pass

    assert not model.is_fitted("VTH0")
    model.set("VTH0", 3.2)
    assert model.is_fitted("VTH0")
    model.reset("VTH0")
    assert not model.is_fitted("VTH0")
    assert model.get("VTH0") == 3.0


def test_init_from_key_params_updates_initial_values():
    ds = load_sdh_excel("datademo/SDH10N2P1WC-AA_SPICE_Data.xlsx")
    model = BSIM3Model(name="nmos1")

    init_from_key_params(model, ds.key_params)

    assert model.get("VTH0") == 3.5
    assert model.get("U0") == 450.0
    assert model.get("BV") == ds.key_params.bvdss_0vgs_v * 0.95

    model.set("VTH0", 3.8)
    model.reset("VTH0")
    assert model.get("VTH0") == 3.5


def test_stage_parameter_mapping_contains_expected_params():
    model = BSIM3Model(name="nmos1")

    s1_params = model.get_params_by_stage("S1")
    s6_params = model.get_params_by_stage("S6")

    assert "VTH0" in s1_params
    assert "NFACTOR" in s1_params
    assert "CGBO" in s6_params
    assert "IS" in s6_params


def test_lib_exporter_writes_bsim3_and_subckt_files(tmp_path):
    ds = load_sdh_excel("datademo/SDH10N2P1WC-AA_SPICE_Data.xlsx")
    model = BSIM3Model(name="nmos1")
    init_from_key_params(model, ds.key_params)
    exporter = LibExporter(part_number=ds.device_info.part_number)

    bsim3_path = exporter.export_bsim3(model, tmp_path / "model.lib")
    bsim3_text = bsim3_path.read_text(encoding="utf-8")

    assert ".MODEL nmos1 NMOS LEVEL=49" in bsim3_text
    assert "VTH0=3.5" in bsim3_text

    subckt_path = exporter.export_subckt(model, tmp_path / "subckt.lib", subckt_name="SDH10N2P1")
    subckt_text = subckt_path.read_text(encoding="utf-8")

    assert ".SUBCKT SDH10N2P1" in subckt_text
    assert "Dbody S D Dbody_diode" in subckt_text
    assert ".MODEL BSIM3_core NMOS" in subckt_text
