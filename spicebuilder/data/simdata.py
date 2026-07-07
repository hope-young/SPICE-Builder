"""
simdata.py
==========
SimData - 核心曲线数据对象（对标 Mystic.SimData）。

每条 SimData 代表一条 SPICE 仿真曲线：
  - 1 个独立变量 (ivar)
  - 1 个因变量 (dvar)
  - 可选的拟合结果 (fit) 和残差 (errors)
  - 元数据 (bias / temperature / instances)

设计目标：
  - 兼容 loader_sdh 输出的 list[dict] 格式
  - 支持 filter / sort / 残差计算
  - 给 Optimizer 提供 fit 评估接口
"""
from __future__ import annotations
from dataclasses import dataclass, field
from typing import Optional
import numpy as np


@dataclass
class SimData:
    """SPICE 仿真曲线数据对象

    Attributes:
        name: 曲线名（如 "IdVg_25C"）
        curve_type: 曲线类型 (IdVg / IdVd / CvVds / Qg / IsVsd)
        data: 字典形式的列数据，至少有 'ivar' 和 'dvar'，可加 'fit' / 'errors'
        metadata: 元数据 (bias, temperature, instances, ...)

    工厂方法:
        from_idvg(), from_idvd(), from_cv(), from_qg(), from_body_diode()
    """
    name: str
    curve_type: str
    data: dict = field(default_factory=dict)
    metadata: dict = field(default_factory=dict)

    def __post_init__(self):
        if 'ivar' not in self.data or 'dvar' not in self.data:
            raise ValueError(f"SimData {self.name} 缺少 ivar 或 dvar")
        iv = np.asarray(self.data['ivar'], dtype=float)
        dv = np.asarray(self.data['dvar'], dtype=float)
        if iv.shape != dv.shape:
            raise ValueError(f"ivar 和 dvar 形状不一致: {iv.shape} vs {dv.shape}")
        self.data['ivar'] = iv
        self.data['dvar'] = dv

    # ---------- 便捷属性 ----------

    @property
    def ivar(self) -> np.ndarray:
        return self.data['ivar']

    @property
    def dvar(self) -> np.ndarray:
        return self.data['dvar']

    @property
    def fit(self) -> Optional[np.ndarray]:
        if 'fit' in self.data and self.data['fit'] is not None:
            return np.asarray(self.data['fit'], dtype=float)
        return None

    @property
    def errors(self) -> Optional[np.ndarray]:
        if 'errors' in self.data and self.data['errors'] is not None:
            return np.asarray(self.data['errors'], dtype=float)
        return None

    @property
    def n_points(self) -> int:
        return len(self.data['ivar'])

    @property
    def ivar_name(self) -> str:
        """独立变量的列名（用于 SPICE 仿真）"""
        return self.metadata.get('ivar_name', self._default_ivar_name())

    @property
    def dvar_name(self) -> str:
        return self.metadata.get('dvar_name', self._default_dvar_name())

    def _default_ivar_name(self) -> str:
        return {
            'IdVg': 'vgs_v',
            'IdVd': 'vds_v',
            'CvVds': 'vds_v',
            'Qg': 'vgs_v',
            'IsVsd': 'vsd_v',
        }.get(self.curve_type, 'x')

    def _default_dvar_name(self) -> str:
        return {
            'IdVg': 'id_a',
            'IdVd': 'id_a',
            'CvVds': 'c_pf',
            'Qg': 'qg_nc',
            'IsVsd': 'is_a',
        }.get(self.curve_type, 'y')

    # ---------- 操作方法 ----------

    def set_fit(self, fit: np.ndarray) -> None:
        """设置拟合结果，自动计算 errors"""
        fit = np.asarray(fit, dtype=float)
        if fit.shape != self.ivar.shape:
            raise ValueError(f"fit 形状 {fit.shape} 与 ivar {self.ivar.shape} 不一致")
        self.data['fit'] = fit
        # 残差 = (fit - target) / target
        with np.errstate(divide='ignore', invalid='ignore'):
            err = (fit - self.dvar) / np.where(self.dvar != 0, self.dvar, 1.0)
        self.data['errors'] = err

    def filter_range(self, vmin: float, vmax: float) -> "SimData":
        """按区间过滤，只保留 ivar 在 [vmin, vmax] 内的点

        用于用户选择 Vgs 区间后，只对该区间做拟合。
        """
        col = np.asarray(self.data["ivar"], dtype=float)
        mask = (col >= vmin) & (col <= vmax)
        new_data = {k: (np.asarray(v)[mask] if v is not None else None)
                    for k, v in self.data.items()}
        new_metadata = dict(self.metadata)
        new_metadata["filter_applied"] = f"ivar in [{vmin:.3f}, {vmax:.3f}]"
        new_metadata["vmin"] = vmin
        new_metadata["vmax"] = vmax
        return SimData(
            name=self.name + "_range",
            curve_type=self.curve_type,
            data=new_data,
            metadata=new_metadata,
        )

    def filter(self, op: str, value: float, dtype: str = "ivar") -> "SimData":
        """按条件过滤数据点

        Args:
            op: "gt" / "lt" / "ge" / "le" / "eq" / "neq"
            value: 阈值
            dtype: "ivar" / "dvar" / "fit" / "errors"
        """
        if dtype not in self.data:
            raise KeyError(f"列 {dtype} 不存在")
        col = np.asarray(self.data[dtype], dtype=float)
        ops = {
            'gt': col > value, 'lt': col < value,
            'ge': col >= value, 'le': col <= value,
            'eq': col == value, 'neq': col != value,
        }
        if op not in ops:
            raise ValueError(f"未知 op: {op}")
        mask = ops[op]
        new_data = {k: (np.asarray(v)[mask] if v is not None else None)
                    for k, v in self.data.items()}
        new_metadata = dict(self.metadata)
        new_metadata['filter_applied'] = f"{dtype} {op} {value}"
        return SimData(
            name=self.name + '_filtered',
            curve_type=self.curve_type,
            data=new_data,
            metadata=new_metadata,
        )

    def sort_by_ivar(self) -> "SimData":
        """按 ivar 升序排序"""
        order = np.argsort(self.ivar)
        new_data = {k: (np.asarray(v)[order] if v is not None else None)
                    for k, v in self.data.items()}
        return SimData(self.name, self.curve_type, new_data, dict(self.metadata))

    def compute_rms(self, error: str = "log") -> float:
        """计算 RMS 误差

        Args:
            error: "log" / "linear" / "relative"
        """
        if self.fit is None:
            return float('inf')
        if error == "log":
            # 对数 RMS（用于 Id-Vg, Id-Vd，跨多个数量级）
            mask = (self.dvar > 0) & (self.fit > 0)
            if not mask.any():
                return float('inf')
            return float(np.sqrt(np.mean(
                (np.log10(self.fit[mask]) - np.log10(self.dvar[mask])) ** 2
            )))
        elif error == "linear":
            return float(np.sqrt(np.mean((self.fit - self.dvar) ** 2)))
        elif error == "relative":
            mask = self.dvar != 0
            if not mask.any():
                return float('inf')
            return float(np.sqrt(np.mean(
                ((self.fit[mask] - self.dvar[mask]) / self.dvar[mask]) ** 2
            )))
        else:
            raise ValueError(f"未知 error: {error}")

    def split_by_metadata(self, key: str, values: list) -> dict[float, "SimData"]:
        """按 metadata key 切分（用于多 Vgs Id-Vd、多温度 Id-Vg）"""
        result = {}
        for v in values:
            mask = np.array([m == v for m in self.metadata.get(key, [])])
            if not mask.any():
                continue
            new_data = {k: (np.asarray(arr)[mask] if arr is not None else None)
                        for k, arr in self.data.items()}
            result[v] = SimData(
                name=f"{self.name}_{key}={v}",
                curve_type=self.curve_type,
                data=new_data,
                metadata={**self.metadata, key: v},
            )
        return result

    # ---------- 工厂方法 ----------

    @classmethod
    def from_idvg(cls, points: list[dict], temperature_c: int = 25,
                  vds_v: float = 5.0) -> "SimData":
        """从 loader_sdh 输出的 Id-Vg 点列表创建 SimData

        Args:
            points: [{'vgs_v', 'id_a', 'vds_v', 'temperature_c'}, ...]
            temperature_c: 选择哪个温度
            vds_v: 选择哪个 Vds
        """
        filtered = [p for p in points
                    if p.get('temperature_c') == temperature_c
                    and p.get('vds_v') == vds_v]
        if not filtered:
            raise ValueError(f"没有匹配的 Id-Vg 点 (T={temperature_c}, Vds={vds_v})")
        # 按 vgs 排序
        filtered.sort(key=lambda p: p['vgs_v'])
        ivar = np.array([p['vgs_v'] for p in filtered])
        dvar = np.array([p['id_a'] for p in filtered])
        return cls(
            name=f"IdVg_Vds{vds_v}V_T{temperature_c}C",
            curve_type="IdVg",
            data={'ivar': ivar, 'dvar': dvar},
            metadata={
                'vds_v': vds_v,
                'temperature_c': temperature_c,
                'ivar_name': 'vgs_v',
                'dvar_name': 'id_a',
            }
        )

    @classmethod
    def from_idvd(cls, points: list[dict], vgs_v: float = 5.0,
                  temperature_c: int = 25) -> "SimData":
        """从 Id-Vd 点列表创建 SimData（按 Vgs 切分）"""
        filtered = [p for p in points
                    if p.get('vgs_v') == vgs_v
                    and p.get('temperature_c') == temperature_c]
        if not filtered:
            raise ValueError(f"没有匹配的 Id-Vd 点 (Vgs={vgs_v}, T={temperature_c})")
        filtered.sort(key=lambda p: p['vds_v'])
        ivar = np.array([p['vds_v'] for p in filtered])
        dvar = np.array([p['id_a'] for p in filtered])
        return cls(
            name=f"IdVd_Vgs{vgs_v}V_T{temperature_c}C",
            curve_type="IdVd",
            data={'ivar': ivar, 'dvar': dvar},
            metadata={
                'vgs_v': vgs_v,
                'temperature_c': temperature_c,
                'ivar_name': 'vds_v',
                'dvar_name': 'id_a',
            }
        )

    @classmethod
    def from_cv(cls, points: list[dict], cap_type: str = "ciss") -> "SimData":
        """从 C-V 点列表创建 SimData

        cap_type: "ciss" / "coss" / "crss"
        """
        col_name = f"{cap_type}_pf"
        filtered = [p for p in points if p.get(col_name) is not None]
        if not filtered:
            raise ValueError(f"没有匹配的 C-V 点 ({cap_type})")
        filtered.sort(key=lambda p: p['vds_v'])
        ivar = np.array([p['vds_v'] for p in filtered])
        dvar = np.array([p[col_name] for p in filtered])
        return cls(
            name=f"CvVds_{cap_type.upper()}",
            curve_type="CvVds",
            data={'ivar': ivar, 'dvar': dvar},
            metadata={
                'cap_type': cap_type,
                'ivar_name': 'vds_v',
                'dvar_name': 'c_pf',
            }
        )

    @classmethod
    def from_body_diode(cls, points: list[dict], temperature_c: int = 25) -> "SimData":
        """从体二极管点列表创建 SimData"""
        filtered = [p for p in points if p.get('temperature_c') == temperature_c]
        if not filtered:
            raise ValueError(f"没有匹配的体二极管点 (T={temperature_c})")
        filtered.sort(key=lambda p: p['vsd_v'])
        ivar = np.array([p['vsd_v'] for p in filtered])
        dvar = np.array([p['is_a'] for p in filtered])
        return cls(
            name=f"IsVsd_T{temperature_c}C",
            curve_type="IsVsd",
            data={'ivar': ivar, 'dvar': dvar},
            metadata={
                'temperature_c': temperature_c,
                'ivar_name': 'vsd_v',
                'dvar_name': 'is_a',
            }
        )

    def __repr__(self):
        return f"SimData({self.name}, {self.curve_type}, n={self.n_points}, rms={self.compute_rms():.3f})"
