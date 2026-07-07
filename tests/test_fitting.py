"""Tests for fitting orchestration without depending on a local LTspice install."""

import numpy as np
import pytest

from spicebuilder.data.simdata import SimData
from spicebuilder.fitting import Engine, Optimizer, Stage
from spicebuilder.models import BSIM3Model


class DeterministicIdVgSimulator:
    """Small deterministic evaluator with the same method shape Stage needs."""

    @staticmethod
    def _idvg(vgs: np.ndarray, vth0: float) -> np.ndarray:
        overdrive = np.maximum(vgs - vth0, 0.0)
        return 1e-12 + 1e-3 * overdrive**2

    def eval_idvg(self, model: BSIM3Model, vgs_arr: np.ndarray, vds: float = 5.0) -> np.ndarray:
        _ = vds
        return self._idvg(vgs_arr, model.get("VTH0"))


def make_idvg_data(target_vth0: float = 3.35) -> SimData:
    vgs = np.linspace(2.5, 5.0, 36)
    ids = DeterministicIdVgSimulator._idvg(vgs, target_vth0)
    return SimData(
        name="IdVg_25C",
        curve_type="IdVg",
        data={"ivar": vgs, "dvar": ids},
        metadata={"temperature_c": 25, "vds_v": 5.0, "vmin": 3.0, "vmax": 5.0},
    )


def test_stage_requires_simulator():
    with pytest.raises(ValueError, match="必须传入 LTspice simulator"):
        Stage(
            "S1_Threshold",
            [make_idvg_data()],
            param_names=["VTH0"],
            model=BSIM3Model(name="nmos1"),
        )


def test_stage_fits_with_simulator_contract():
    model = BSIM3Model(name="nmos1")
    model.set_initial("VTH0", 3.0)
    stage = Stage(
        "S1_Threshold",
        [make_idvg_data(target_vth0=3.35)],
        param_names=["VTH0"],
        model=model,
        error_func="log",
        simulator=DeterministicIdVgSimulator(),
    )
    optimizer = Optimizer(method="trf").set_max_iter(80).set_eps1(1e-9).set_eps2(1e-9).set_eps3(1e-9)

    result = stage.run(optimizer)

    assert result.success
    assert result.r_squared > 0.99
    assert model.get("VTH0") == pytest.approx(3.35, abs=0.03)
    assert stage.simdata[0].fit is not None


def test_engine_runs_stage_pipeline():
    model = BSIM3Model(name="nmos1")
    stage = Stage(
        "S1_Threshold",
        [make_idvg_data(target_vth0=3.25)],
        param_names=["VTH0"],
        model=model,
        error_func="log",
        simulator=DeterministicIdVgSimulator(),
    )
    optimizer = Optimizer(method="trf").set_max_iter(80)
    engine = Engine([stage], error_threshold=0.05, max_loops=2)

    result = engine.run(optimizer)

    assert result.success
    assert result.total_rms < 0.05
    assert len(result.stage_results) == 1
