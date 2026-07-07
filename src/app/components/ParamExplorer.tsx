// ParamExplorer.tsx - BSIM3 参数实时探索器
// 用户拖动滑块，停顿后自动刷新 LTspice 仿真曲线与实测曲线对比图
import { useState, useEffect, useRef, useCallback, useMemo } from "react";
import {
  LineChart, Line, XAxis, YAxis, CartesianGrid, Tooltip,
  ResponsiveContainer, Legend
} from "recharts";
import { ChevronRight, ChevronDown, RotateCcw, Sliders } from "lucide-react";
import { useApp } from "../../lib/store";
import { simulateCurve } from "../../lib/api";
import { BSIM3_PARAMS, C } from "../../lib/constants";
import type { BSIM3ParamSpec } from "../../lib/types";

// 从 constants.ts 复用 UI 组件（虽然直接内联也可以）
// 注意：这里直接内联样式以保持一致性

interface SimResult {
  ivar: number[];
  sim: number[];
  meas: number[];
  metadata: Record<string, unknown>;
}

// 计算 slider step（参数范围 / ~100 步）
function computeStep(lower: number, upper: number): number {
  const range = upper - lower;
  if (!isFinite(range) || range === 0) return 0.001;
  if (range >= 1000) return 10;
  if (range >= 100) return 1;
  if (range >= 10) return 0.1;
  if (range >= 1) return 0.01;
  if (range >= 0.1) return 0.001;
  if (range >= 0.01) return 0.0001;
  return range / 100;
}

// 格式化参数值（科学计数法或小数）
function fmtParamValue(v: number): string {
  if (v === 0) return "0";
  const abs = Math.abs(v);
  if (abs >= 1e4 || abs < 1e-3) return v.toExponential(2);
  return parseFloat(v.toPrecision(4)).toString();
}

// 唯一分类列表（保持顺序）
const CATEGORIES = Array.from(
  new Map(BSIM3_PARAMS.map(p => [p.category, p.category])).keys()
);

export function ParamExplorer() {
  const { projectId, dataset, model } = useApp();

  // 分类展开状态
  const [expandedCats, setExpandedCats] = useState<Set<string>>(
    new Set(["Threshold", "Mobility"])
  );

  // 当前参数值（keyed by param name）
  // 初始值从 BSIM3_PARAMS.default 读取，之后由用户拖动改变
  const [paramValues, setParamValues] = useState<Record<string, number>>(() => {
    const init: Record<string, number> = {};
    BSIM3_PARAMS.forEach(p => { init[p.name] = p.default; });
    return init;
  });

  // 仿真结果
  const [simResult5v, setSimResult5v] = useState<SimResult | null>(null);
  const [simResult05v, setSimResult05v] = useState<SimResult | null>(null);
  const [isSimulating, setIsSimulating] = useState(false);

  // 防抖 timer ref
  const debounceTimer = useRef<number | null>(null);
  // 记录"正在等待"的最新参数值
  const pendingParams = useRef<Record<string, number>>({});

  // 客户端 LRU 缓存（key = JSON(sorted params), value = sim array）
  const simCache = useRef<Map<string, number[]>>(new Map());

  // 拉取实测数据（从 project data）
  const [measured5v, setMeasured5v] = useState<{ ivar: number[]; meas: number[] } | null>(null);

  // 初始化时从 model 同步参数值
  useEffect(() => {
    if (!model?.params) return;
    setParamValues(prev => {
      const next = { ...prev };
      let changed = false;
      Object.entries(model.params).forEach(([name, val]) => {
        if (typeof val === "number" && name in next) {
          if (next[name] !== val) { next[name] = val; changed = true; }
        }
      });
      return changed ? next : prev;
    });
  }, [model]);

  // 拉取实测曲线数据
  useEffect(() => {
    if (!projectId) return;
    const fetchMeas = async () => {
      try {
        const r5 = await simulateCurve(projectId, {
          curveType: "idvg",
          paramOverrides: {},
          vds: 5.0,
        });
        const r05 = await simulateCurve(projectId, {
          curveType: "idvg",
          paramOverrides: {},
          vds: 0.5,
        });
        setMeasured5v({ ivar: r5.ivar, meas: r5.meas });
        setSimResult5v(r5);
        setSimResult05v(r05);
      } catch (e) {
        console.error("Failed to load measured curves:", e);
      }
    };
    fetchMeas();
  }, [projectId]);

  // 核心：发起仿真请求
  const fetchSimulation = useCallback(async (params: Record<string, number>) => {
    if (!projectId) return;
    setIsSimulating(true);
    try {
      const cacheKey = JSON.stringify(Object.entries(params).sort());

      // 预热缓存：如果已有缓存则直接用
      const cached5v = simCache.current.get(cacheKey + "_5v");
      const cached05v = simCache.current.get(cacheKey + "_05v");

      const [r5, r05] = await Promise.all([
        simulateCurve(projectId, { curveType: "idvg", paramOverrides: params, vds: 5.0 }),
        simulateCurve(projectId, { curveType: "idvg", paramOverrides: params, vds: 0.5 }),
      ]);

      simCache.current.set(cacheKey + "_5v", r5.sim);
      simCache.current.set(cacheKey + "_05v", r05.sim);
      // LRU 淘汰：超过 100 条删最旧的
      if (simCache.current.size > 200) {
        const firstKey = simCache.current.keys().next().value;
        if (firstKey) simCache.current.delete(firstKey);
      }

      setSimResult5v(r5);
      setSimResult05v(r05);
    } catch (e) {
      console.error("Simulation failed:", e);
    } finally {
      setIsSimulating(false);
    }
  }, [projectId]);

  // 滑块变化处理（防抖）
  const onSliderChange = useCallback((name: string, value: number) => {
    setParamValues(prev => ({ ...prev, [name]: value }));
    pendingParams.current = { ...pendingParams.current, [name]: value };

    if (debounceTimer.current !== null) {
      clearTimeout(debounceTimer.current);
    }
    debounceTimer.current = window.setTimeout(() => {
      fetchSimulation({ ...pendingParams.current });
    }, 300);
  }, [fetchSimulation]);

  // 单个参数重置
  const resetParam = useCallback((name: string) => {
    const spec = BSIM3_PARAMS.find(p => p.name === name);
    if (!spec) return;
    const defaultVal = spec.default;
    setParamValues(prev => { const n = { ...prev }; n[name] = defaultVal; return n; });
    delete pendingParams.current[name];
    const next = { ...pendingParams.current };
    if (debounceTimer.current !== null) clearTimeout(debounceTimer.current);
    debounceTimer.current = window.setTimeout(() => {
      fetchSimulation(next);
    }, 50);
  }, [fetchSimulation]);

  // 分类重置
  const resetCategory = useCallback((cat: string) => {
    const catParams = BSIM3_PARAMS.filter(p => p.category === cat);
    setParamValues(prev => {
      const next = { ...prev };
      catParams.forEach(p => { next[p.name] = p.default; });
      return next;
    });
    catParams.forEach(p => { delete pendingParams.current[p.name]; });
    const next = { ...pendingParams.current };
    if (debounceTimer.current !== null) clearTimeout(debounceTimer.current);
    debounceTimer.current = window.setTimeout(() => {
      fetchSimulation(next);
    }, 50);
  }, [fetchSimulation]);

  // 构建图表数据
  const chartData5v = useMemo(() => {
    if (!simResult5v) return [];
    return simResult5v.ivar.map((v, i) => ({
      vgs: v,
      measured: simResult5v.meas[i],
      simulated: simResult5v.sim[i],
    }));
  }, [simResult5v]);

  const chartData05v = useMemo(() => {
    if (!simResult05v) return [];
    return simResult05v.ivar.map((v, i) => ({
      vgs: v,
      measured: simResult05v.meas[i],
      simulated: simResult05v.sim[i],
    }));
  }, [simResult05v]);

  // 每个分类的参数列表
  const paramsByCategory = useMemo(() => {
    const m = new Map<string, BSIM3ParamSpec[]>();
    BSIM3_PARAMS.forEach(p => {
      if (!m.has(p.category)) m.set(p.category, []);
      m.get(p.category)!.push(p);
    });
    return m;
  }, []);

  // ==================== 渲染 ====================
  return (
    <div style={{ display: "flex", height: "100%", overflow: "hidden" }}>
      {/* 左侧：分类树 */}
      <div style={{
        width: 220,
        borderRight: "1px solid var(--border)",
        overflowY: "auto",
        padding: "8px 0",
        flexShrink: 0,
      }}>
        <div style={{
          fontSize: 10,
          color: "var(--muted)",
          padding: "4px 12px 8px",
          textTransform: "uppercase",
          letterSpacing: "0.05em",
        }}>
          Parameter Categories
        </div>
        {CATEGORIES.map(cat => {
          const isExpanded = expandedCats.has(cat);
          const catParams = paramsByCategory.get(cat) || [];
          return (
            <div key={cat}>
              <div style={{ display: "flex", alignItems: "center", padding: "4px 8px" }}>
                <button
                  onClick={() => {
                    setExpandedCats(prev => {
                      const n = new Set(prev);
                      if (n.has(cat)) n.delete(cat); else n.add(cat);
                      return n;
                    });
                  }}
                  style={{
                    background: "none", border: "none", cursor: "pointer",
                    padding: "2px 4px", color: "var(--muted)", display: "flex",
                  }}
                >
                  {isExpanded
                    ? <ChevronDown size={12} />
                    : <ChevronRight size={12} />}
                </button>
                <span style={{ fontSize: 12, fontWeight: 600, flex: 1 }}>{cat}</span>
                <button
                  onClick={() => resetCategory(cat)}
                  title={`Reset all ${cat} params`}
                  style={{
                    background: "none", border: "none", cursor: "pointer",
                    padding: "2px", color: "var(--muted)", display: "flex",
                  }}
                >
                  <RotateCcw size={10} />
                </button>
              </div>
              {isExpanded && catParams.map(p => (
                <div
                  key={p.name}
                  style={{
                    padding: "2px 8px 2px 28px",
                    fontSize: 11,
                    color: "var(--muted)",
                    display: "flex",
                    justifyContent: "space-between",
                  }}
                >
                  <span style={{ fontFamily: "monospace" }}>{p.name}</span>
                  <span style={{ color: "var(--text)" }}>{fmtParamValue(paramValues[p.name] ?? p.default)}</span>
                </div>
              ))}
            </div>
          );
        })}
      </div>

      {/* 中间：参数滑块 */}
      <div style={{
        flex: 1,
        overflowY: "auto",
        padding: "12px 16px",
      }}>
        <div style={{
          display: "flex", alignItems: "center", gap: 8,
          marginBottom: 16, paddingBottom: 12,
          borderBottom: "1px solid var(--border)",
        }}>
          <Sliders size={14} color="var(--primary)" />
          <span style={{ fontWeight: 600, fontSize: 14 }}>BSIM3 Parameters</span>
          {isSimulating && (
            <span style={{ fontSize: 11, color: "var(--warning)", marginLeft: 8 }}>
              Simulating...
            </span>
          )}
        </div>

        {/* 只渲染当前展开分类的滑块 */}
        {Array.from(expandedCats).map(cat => {
          const catParams = paramsByCategory.get(cat) || [];
          return (
            <div key={cat} style={{ marginBottom: 24 }}>
              <div style={{
                fontSize: 11, fontWeight: 700, color: "var(--primary)",
                textTransform: "uppercase", letterSpacing: "0.05em",
                marginBottom: 10,
              }}>
                {cat}
              </div>
              {catParams.map(p => {
                const cur = paramValues[p.name] ?? p.default;
                const step = computeStep(p.lower, p.upper);
                return (
                  <div key={p.name} style={{
                    display: "flex", alignItems: "center",
                    gap: 10, padding: "5px 0",
                    borderBottom: "1px solid var(--border)",
                  }}>
                    {/* 参数名 */}
                    <div style={{
                      width: 90, flexShrink: 0,
                      fontFamily: "monospace", fontSize: 11,
                    }}>
                      <div style={{ fontWeight: 600 }}>{p.name}</div>
                      <div style={{ fontSize: 9, color: "var(--muted)" }}>
                        {p.unit ? `${p.lower} ~ ${p.upper} ${p.unit}` : `${p.lower} ~ ${p.upper}`}
                      </div>
                    </div>

                    {/* 滑块 */}
                    <input
                      type="range"
                      min={p.lower}
                      max={p.upper}
                      step={step}
                      value={cur}
                      onChange={e => onSliderChange(p.name, parseFloat(e.target.value))}
                      style={{ flex: 1, cursor: "pointer" }}
                    />

                    {/* 当前值 */}
                    <div style={{
                      width: 80, textAlign: "right",
                      fontFamily: "monospace", fontSize: 11,
                    }}>
                      {fmtParamValue(cur)}
                    </div>

                    {/* 重置按钮 */}
                    <button
                      onClick={() => resetParam(p.name)}
                      title={`Reset ${p.name} to default`}
                      style={{
                        background: "none", border: "none", cursor: "pointer",
                        padding: "2px", color: "var(--muted)", display: "flex",
                      }}
                    >
                      <RotateCcw size={10} />
                    </button>
                  </div>
                );
              })}
            </div>
          );
        })}
      </div>

      {/* 右侧：曲线图 */}
      <div style={{
        width: 420,
        borderLeft: "1px solid var(--border)",
        display: "flex",
        flexDirection: "column",
        overflowY: "auto",
        flexShrink: 0,
      }}>
        <div style={{
          padding: "12px 16px 8px",
          fontWeight: 600, fontSize: 14,
          borderBottom: "1px solid var(--border)",
          display: "flex", alignItems: "center", gap: 8,
        }}>
          Id-Vg Curves
          {isSimulating && <span style={{ fontSize: 11, color: "var(--warning)" }}>↻</span>}
        </div>

        {/* Vds=5V 子图 */}
        <div style={{ flex: 1, minHeight: 220, padding: "8px 8px 0" }}>
          <div style={{ fontSize: 10, color: "var(--muted)", marginBottom: 4, paddingLeft: 4 }}>
            Vds = 5.0 V (Saturation)
          </div>
          <ResponsiveContainer width="100%" height={200}>
            <LineChart data={chartData5v} margin={{ top: 4, right: 12, bottom: 4, left: -8 }}>
              <CartesianGrid strokeDasharray="3 3" stroke="var(--border)" />
              <XAxis
                dataKey="vgs"
                tick={{ fontSize: 9 }}
                label={{ value: "Vgs (V)", position: "insideBottom", offset: -2, fontSize: 9 }}
              />
              <YAxis tick={{ fontSize: 9 }} />
              <Tooltip
                formatter={(v: number) => v.toExponential(3)}
                labelFormatter={(v) => `Vgs=${(v as number).toFixed(2)}V`}
                contentStyle={{ fontSize: 10 }}
              />
              <Legend wrapperStyle={{ fontSize: 10 }} />
              <Line
                type="monotone" dataKey="measured"
                stroke="#9ca3af" strokeWidth={1.5} dot={false}
                name="Measured" isAnimationActive={false}
              />
              <Line
                type="monotone" dataKey="simulated"
                stroke="#0d99ff" strokeWidth={2} dot={false}
                name="Simulated" isAnimationActive={false}
              />
            </LineChart>
          </ResponsiveContainer>
        </div>

        {/* Vds=0.5V 子图 */}
        <div style={{ flex: 1, minHeight: 220, padding: "8px 8px 0" }}>
          <div style={{ fontSize: 10, color: "var(--muted)", marginBottom: 4, paddingLeft: 4 }}>
            Vds = 0.5 V (Linear)
          </div>
          <ResponsiveContainer width="100%" height={200}>
            <LineChart data={chartData05v} margin={{ top: 4, right: 12, bottom: 4, left: -8 }}>
              <CartesianGrid strokeDasharray="3 3" stroke="var(--border)" />
              <XAxis
                dataKey="vgs"
                tick={{ fontSize: 9 }}
                label={{ value: "Vgs (V)", position: "insideBottom", offset: -2, fontSize: 9 }}
              />
              <YAxis tick={{ fontSize: 9 }} />
              <Tooltip
                formatter={(v: number) => v.toExponential(3)}
                labelFormatter={(v) => `Vgs=${(v as number).toFixed(2)}V`}
                contentStyle={{ fontSize: 10 }}
              />
              <Legend wrapperStyle={{ fontSize: 10 }} />
              <Line
                type="monotone" dataKey="measured"
                stroke="#9ca3af" strokeWidth={1.5} dot={false}
                name="Measured" isAnimationActive={false}
              />
              <Line
                type="monotone" dataKey="simulated"
                stroke="#0d99ff" strokeWidth={2} dot={false}
                name="Simulated" isAnimationActive={false}
              />
            </LineChart>
          </ResponsiveContainer>
        </div>

        {/* 提示 */}
        <div style={{
          padding: "8px 12px",
          fontSize: 10,
          color: "var(--muted)",
          borderTop: "1px solid var(--border)",
        }}>
          Drag sliders to adjust parameters. Chart updates after 300ms pause.
        </div>
      </div>
    </div>
  );
}