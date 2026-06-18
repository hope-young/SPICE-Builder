"""
run_demo.py
===========
SpiceBuilder 端到端 demo。

流程：
  1. 加载 SDH Excel 数据
  2. 推 BSIM3 49 参数初始值
  3. 构建 SimData
  4. 跑 6 阶段 SGT 拟合策略
  5. 导出 .lib（subckt 包装）
  6. 用 LTspice 回放验证
  7. 对比拟合 vs 实测

用法：
  python scripts/run_demo.py
"""
import sys
import io
sys.stdout = io.TextIOWrapper(sys.stdout.buffer, encoding='utf-8')

from pathlib import Path
from spicebuilder.data.loader_sdh import load_sdh_excel
from spicebuilder.data.simdata import SimData
from spicebuilder.models.bsim3 import BSIM3Model
from spicebuilder.models.init_values import init_from_key_params
from spicebuilder.models.exporter import LibExporter
from spicebuilder.fitting.optimizer import Optimizer
from spicebuilder.strategy.sgt_6stage import build_sgt_engine
from spicebuilder.simulator.ltspice import LTspiceBackend, gen_idvg_netlist


def main():
    repo_root = Path(__file__).resolve().parent.parent

    print("=" * 60)
    print("SpiceBuilder End-to-End Demo")
    print("Device: Silicon-Magic SDH10N2P1WC-AA (100V SGT MOSFET)")
    print("=" * 60)

    # 1. 加载数据
    excel_path = repo_root / "datademo" / "SDH10N2P1WC-AA_SPICE_Data.xlsx"
    print(f"\n[1/7] Loading data from {excel_path.name}...")
    ds = load_sdh_excel(excel_path)
    print(f"  Device: {ds.device_info.part_number}")
    print(f"  Package: {ds.device_info.package}")
    print(f"  BVdss: {ds.device_info.bvdss_rated_v}V")
    print(f"  RDSon max: {ds.device_info.rdson_max_ohm*1e3:.2f} mOhm")
    print(f"  Id-Vg @5V: {len(ds.idvg_vds5)} pts")
    print(f"  Id-Vd: {len(ds.idvd)} pts")
    print(f"  C-V: {len(ds.cv_vds)} pts")

    # 2. 推 BSIM3 初始值
    print(f"\n[2/7] Initializing 49 BSIM3 parameters from datasheet...")
    model = BSIM3Model()
    init_from_key_params(model, ds.key_params)
    print(f"  VTH0 init: {model.get('VTH0'):.3f} V")
    print(f"  U0 init:   {model.get('U0'):.1f} cm2/Vs")
    print(f"  RD init:   {model.get('RD'):.2e} ohm")
    print(f"  KT1 init:  {model.get('KT1'):.3f}")

    # 3. 导出初始 .lib
    print(f"\n[3/7] Exporting initial .lib...")
    lib_path = repo_root / "datademo" / "SDH10N2P1WC-AA.lib"
    exporter = LibExporter(part_number=ds.device_info.part_number)
    exporter.export_subckt(
        model, lib_path,
        subckt_name='SDH10N2P1',
        rg_ohm=ds.key_params.rg_internal_ohm,
    )
    print(f"  Written to {lib_path}")

    # 4. 用 LTspice 验证 .lib 可加载
    print(f"\n[4/7] Validating .lib with LTspice...")
    backend = LTspiceBackend()
    netlist = gen_idvg_netlist(str(lib_path), vgs_min=0, vgs_max=5, vgs_step=0.5, vds_v=0.5,
                                model_name='SDH10N2P1', use_subckt=True)
    result = backend.run_netlist_text(netlist, timeout_s=30)
    if not result.success:
        print(f"  [ERROR] LTspice failed: {result.error[:200]}")
        print(f"  Log: {result.log_text[-500:]}")
        return 1
    print(f"  [OK] LTspice ran successfully in {result.elapsed_s:.2f}s")
    print(f"  Log: 'Total elapsed time' present = {'Total elapsed time' in result.log_text}")

    # 5. 构建 SimData
    print(f"\n[5/7] Building SimData...")
    idvg = SimData.from_idvg(ds.idvg_vds5, temperature_c=25, vds_v=5.0)
    idvd = SimData.from_idvd(ds.idvd, vgs_v=10.0, temperature_c=25)
    print(f"  IdVg @5V: {idvg.n_points} pts")
    print(f"  IdVd @Vgs=10V: {idvd.n_points} pts")

    # 6. 跑 6 阶段策略
    print(f"\n[6/7] Running 6-stage BSIM3 extraction...")
    opt = Optimizer(method='trf')
    opt.set_eps1(1e-2)
    opt.set_eps2(1e-2)
    opt.set_max_iter(30)

    engine = build_sgt_engine(
        dataset=ds,
        model=model,
        optimizer=opt,
        error_threshold=10.0,
        max_loops=1,
        verbose=True,
    )
    result = engine.run(opt)
    print(f"\n  Overall: success={result.success}, total_rms={result.total_rms:.3f}")
    for sr in result.stage_results:
        flag = "OK" if sr.success else "FAIL"
        print(f"    {sr.stage_name:30s} rms={sr.rms:7.3f}  {flag}")

    # 7. 导出最终 .lib
    print(f"\n[7/7] Exporting fitted .lib...")
    exporter.export_subckt(
        model, lib_path,
        subckt_name='SDH10N2P1',
        rg_ohm=ds.key_params.rg_internal_ohm,
    )
    print(f"  Fitted VTH0: {model.get('VTH0'):.3f} V")
    print(f"  Fitted U0:   {model.get('U0'):.1f} cm2/Vs")
    print(f"  Fitted VSAT: {model.get('VSAT'):.2e} m/s")
    print(f"  Written to {lib_path}")

    print("\n" + "=" * 60)
    print("Demo complete!")
    print("=" * 60)
    return 0


if __name__ == '__main__':
    sys.exit(main())
