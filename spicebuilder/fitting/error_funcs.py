"""
error_funcs.py
==============
误差函数 - 用于评估拟合质量。
"""
from __future__ import annotations
import numpy as np


def rms_log(measured: np.ndarray, simulated: np.ndarray) -> float:
    """对数 RMS（用于 Id-Vg, Id-Vd，跨多个数量级）

    RMSE = sqrt(mean((log10(sim) - log10(meas))^2))
    """
    measured = np.asarray(measured, dtype=float)
    simulated = np.asarray(simulated, dtype=float)
    mask = (measured > 0) & (simulated > 0) & np.isfinite(measured) & np.isfinite(simulated)
    if not mask.any():
        return float('inf')
    return float(np.sqrt(np.mean(
        (np.log10(simulated[mask]) - np.log10(measured[mask])) ** 2
    )))


def rms_linear(measured: np.ndarray, simulated: np.ndarray) -> float:
    """线性 RMS（用于 C-V, Qg, Body Diode）"""
    measured = np.asarray(measured, dtype=float)
    simulated = np.asarray(simulated, dtype=float)
    mask = np.isfinite(measured) & np.isfinite(simulated)
    if not mask.any():
        return float('inf')
    return float(np.sqrt(np.mean((simulated[mask] - measured[mask]) ** 2)))


def rms_relative(measured: np.ndarray, simulated: np.ndarray) -> float:
    """相对 RMS"""
    measured = np.asarray(measured, dtype=float)
    simulated = np.asarray(simulated, dtype=float)
    mask = (measured != 0) & np.isfinite(measured) & np.isfinite(simulated)
    if not mask.any():
        return float('inf')
    return float(np.sqrt(np.mean(
        ((simulated[mask] - measured[mask]) / measured[mask]) ** 2
    )))


def weighted_rms(measured: np.ndarray, simulated: np.ndarray, weights: np.ndarray) -> float:
    """加权 RMS"""
    measured = np.asarray(measured, dtype=float)
    simulated = np.asarray(simulated, dtype=float)
    weights = np.asarray(weights, dtype=float)
    mask = (weights > 0) & np.isfinite(measured) & np.isfinite(simulated)
    if not mask.any():
        return float('inf')
    return float(np.sqrt(np.average(
        (simulated[mask] - measured[mask]) ** 2,
        weights=weights[mask]
    )))


ERROR_FUNCS = {
    "log": rms_log,
    "linear": rms_linear,
    "relative": rms_relative,
    "weighted": weighted_rms,
}
