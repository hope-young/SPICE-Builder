"""
engine.py
=========
Engine - 多阶段拟合编排器（对标 Mystic Engine.extract）。

外层 max_loops 循环：跑完所有 Stage → 算总 RMS → 未达阈值 → 重头再跑。
"""
from __future__ import annotations
from dataclasses import dataclass, field
from typing import Optional
import numpy as np

from .stage import Stage, StageResult
from .optimizer import Optimizer


@dataclass
class EngineResult:
    success: bool
    total_rms: float
    iterations: int           # 外层循环次数
    stage_results: list[StageResult] = field(default_factory=list)
    message: str = ""


class Engine:
    """多阶段拟合编排

    用法:
        engine = Engine([stage1, stage2, stage3], error_threshold=2.0, max_loops=3)
        result = engine.run(optimizer)
    """

    def __init__(self,
                 stages: list[Stage],
                 error_threshold: float = 0.5,
                 max_loops: int = 3):
        self.stages = stages
        self.error_threshold = error_threshold
        self.max_loops = max_loops

    def run(self, optimizer: Optimizer) -> EngineResult:
        """跑整个 pipeline

        外层循环：max_loops 次
        内层：按顺序跑所有 stage
        """
        all_stage_results = []
        prev_total_rms = float('inf')

        for loop_idx in range(self.max_loops):
            loop_results = []
            total_rms_sq = 0.0
            n_points = 0

            for stage in self.stages:
                result = stage.run(optimizer)
                loop_results.append(result)
                total_rms_sq += result.rms ** 2
                n_points += 1

            loop_rms = float(np.sqrt(total_rms_sq / max(1, n_points)))
            all_stage_results.extend(loop_results)

            # 收敛判据：loop RMS < threshold
            if loop_rms < self.error_threshold:
                return EngineResult(
                    success=True,
                    total_rms=loop_rms,
                    iterations=loop_idx + 1,
                    stage_results=loop_results,  # 最后一次 loop 的结果
                    message=f"Converged in {loop_idx + 1} loop(s), RMS={loop_rms:.4f}",
                )

            # 检查是否还在改善
            if abs(prev_total_rms - loop_rms) < 1e-6:
                return EngineResult(
                    success=False,
                    total_rms=loop_rms,
                    iterations=loop_idx + 1,
                    stage_results=loop_results,
                    message=f"Converged (no improvement), RMS={loop_rms:.4f}",
                )
            prev_total_rms = loop_rms

        return EngineResult(
            success=False,
            total_rms=loop_rms,
            iterations=self.max_loops,
            stage_results=loop_results,
            message=f"Max loops reached, RMS={loop_rms:.4f} (target {self.error_threshold})",
        )
