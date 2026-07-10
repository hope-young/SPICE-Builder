// ParamSliders.tsx - BSIM3 参数滑块组件（供 SingleCurveFit 和 ParamExplorer 共用）
// 每个参数行: 勾选 | 名称 | min 输入框 | 滑块 | max 输入框 | 当前值 | reset
// 输入框为空 → 显示默认值 (灰度), 有值 → 自定义
import { useState, useRef, useEffect } from "react";
import { Lock, Unlock, RotateCcw } from "lucide-react";
import { BSIM3_PARAMS } from "../../lib/constants";

const CAT_ORDER = ["Threshold", "Mobility", "Saturation", "Parasitic", "OutputRes", "Capacitance", "Junction", "Temperature", "Diode", "GateLeakage", "Process", "Doping"];
const CATS = CAT_ORDER.filter(c => BSIM3_PARAMS.some(p => p.category === c));

const PARAM_CN: Record<string, { short: string; detail: string }> = {
  VTH0: { short: "阈值电压", detail: "零偏阈值电压。主要决定 Id-Vg 曲线沿 Vgs 方向的左右位置，是转移特性拟合的核心参数。" },
  K1: { short: "体效应1", detail: "一阶体效应系数。影响衬底偏置下阈值电压变化，单条 Vbs=0 的 Id-Vg 中可辨识度有限。" },
  K2: { short: "体效应2", detail: "二阶体效应系数。用于修正体效应非线性，通常需要多体偏或更多曲线约束。" },
  DVT0: { short: "短沟道0", detail: "短沟道阈值滚降参数。影响沟道长度缩短时阈值变化，在固定几何单曲线中需谨慎释放。" },
  DVT1: { short: "短沟道1", detail: "短沟道效应的指数/尺度参数。常与 DVT0 联合作用，过度释放容易和 VTH0 互相补偿。" },
  NFACTOR: { short: "亚阈因子", detail: "亚阈值摆幅因子。影响低电流区 Id 随 Vgs 上升的斜率，对 log 域 Id-Vg 拟合很敏感。" },
  CDSC: { short: "沟道耦合", detail: "源漏到沟道的耦合电容相关参数。会影响亚阈值区域形状，通常与 NFACTOR 一起微调。" },
  CDSCD: { short: "漏偏耦合", detail: "漏偏相关的沟道耦合参数。用于描述 Vds 改变时亚阈值形状变化，适合多 Vds Id-Vg 联合约束。" },
  CDSCB: { short: "体偏耦合", detail: "体偏相关的沟道耦合参数。没有体偏扫描数据时通常不建议大幅释放。" },
  U0: { short: "低场迁移率", detail: "低场载流子迁移率。主要控制线性区和中高电流区的电流水平。" },
  UA: { short: "迁移率退化1", detail: "栅压导致迁移率退化的一阶系数。影响高 Vgs 区域斜率和电流压缩。" },
  UB: { short: "迁移率退化2", detail: "栅压导致迁移率退化的二阶系数。用于修正高栅压下电流弯曲，和 UA 相关性较强。" },
  UC: { short: "体偏迁移率", detail: "体偏对迁移率的影响参数。没有体偏数据时可辨识度有限。" },
  VSAT: { short: "饱和速度", detail: "载流子饱和速度。影响高场条件下电流饱和和高 Vds 转移曲线形状。" },
  A0: { short: "体电荷效应", detail: "bulk charge effect 参数。影响饱和区电流形状和高 Vgs 区域曲率。" },
  AGS: { short: "栅偏 A0", detail: "A0 的栅偏依赖项。常用于调整高栅压下的饱和电流形状。" },
  KETA: { short: "体偏 VSAT", detail: "体偏相关的饱和速度修正。单条 Id-Vg 中通常不强约束。" },
  RD: { short: "漏串联电阻", detail: "漏极串联电阻。会影响大电流区电压降和 Id-Vd 输出特性，导出/导入模型时必须保留。" },
  RS: { short: "源串联电阻", detail: "源极串联电阻。会反馈到有效 Vgs，影响大电流区电流和转移曲线高端形状。" },
  PCLM: { short: "沟长调制", detail: "沟长调制系数。主要影响输出特性 Id-Vd 的饱和区斜率，对 Id-Vg 单曲线约束较弱。" },
  PDIBLC1: { short: "DIBL 1", detail: "漏致势垒降低参数 1。需要不同 Vds 的 Id-Vg 对比来约束。" },
  PDIBLC2: { short: "DIBL 2", detail: "漏致势垒降低参数 2。影响高漏压下阈值漂移，适合多 Vds 转移曲线拟合。" },
  DROUT: { short: "输出电阻", detail: "DIBL 沟长依赖项。主要用于输出特性拟合，不建议只靠 Id-Vg 单曲线释放。" },
  PVAG: { short: "栅控输出", detail: "栅压对输出电阻/沟长调制的影响参数。主要由 Id-Vd 或多 Vds 曲线约束。" },
  CGSO: { short: "栅源重叠", detail: "栅源重叠电容。主要用于 C-V/Qg 拟合，对静态 Id-Vg 基本不可辨识。" },
  CGDO: { short: "栅漏重叠", detail: "栅漏重叠电容。主要影响 Crss/Qgd 等动态或电容特性。" },
  CGBO: { short: "栅体重叠", detail: "栅体重叠电容。主要用于电容模型，转移曲线中不建议释放。" },
  MJ: { short: "底结梯度", detail: "底结电容梯度系数。用于结电容电压依赖，属于 C-V 参数。" },
  MJSW: { short: "侧壁梯度", detail: "侧壁结电容梯度系数。主要由 C-V 数据约束。" },
  PB: { short: "底结电势", detail: "底结内建电势。影响结电容模型，不适合 Id-Vg 单曲线拟合。" },
  PBSW: { short: "侧壁电势", detail: "侧壁结内建电势。用于侧壁结电容模型。" },
  TT: { short: "渡越时间", detail: "载流子渡越时间。偏动态/电荷参数，静态 Id-Vg 中通常不可辨识。" },
  KT1: { short: "Vth温漂1", detail: "阈值电压一阶温度系数。需要多温度曲线约束。" },
  KT2: { short: "Vth温漂2", detail: "阈值电压二阶温度系数。没有温度扫描时不建议释放。" },
  UTE: { short: "迁移率温漂", detail: "迁移率温度指数。用于温度相关拟合。" },
  UA1: { short: "UA温漂", detail: "UA 的温度系数。需要多温度数据约束。" },
  UB1: { short: "UB温漂", detail: "UB 的温度系数。需要多温度数据约束。" },
  UC1: { short: "UC温漂", detail: "UC 的温度系数。需要多温度数据约束。" },
  PRT: { short: "电阻温漂", detail: "寄生电阻温度系数。主要影响温度下的导通电阻变化。" },
  TNOM: { short: "标称温度", detail: "模型参数的标称温度。通常保持为测量参考温度，不作为普通拟合变量。" },
  IS: { short: "二极管电流", detail: "体二极管饱和电流。用于 body diode 拟合，对 Id-Vg 转移曲线无直接约束。" },
  N: { short: "二极管理想因子", detail: "体二极管理想因子。需要二极管 I-V 数据约束。" },
  BV: { short: "击穿电压", detail: "体二极管反向击穿电压。用于击穿/体二极管模型。" },
  IBV: { short: "击穿电流", detail: "达到 BV 时的参考电流。用于反向击穿区域。" },
  IGS0: { short: "栅漏电流", detail: "栅源击穿模型的参考漏电流。用于 BVGSS+ / BVGSS- 拟合。" },
  VGSLP: { short: "栅击穿斜率", detail: "栅源击穿后的电流上升软化斜率。数值越小，击穿拐点越陡。" },
  BVGSP: { short: "正栅击穿", detail: "正向栅源击穿电压，对应 BVGSS+ 曲线。" },
  BVGSN: { short: "负栅击穿", detail: "负向栅源击穿电压，对应 BVGSS- 曲线。" },
  TOX: { short: "栅氧厚度", detail: "栅氧厚度。影响栅氧电容和沟道电流强度，和 U0/VTH0 可能存在相关性。" },
  XL: { short: "沟长偏差", detail: "有效沟道长度偏差。影响电流尺度和短沟道效应，需谨慎释放。" },
  XW: { short: "沟宽偏差", detail: "有效沟道宽度偏差。影响电流尺度，可能和器件并联倍数/宽度设置互相补偿。" },
  DELTA: { short: "Vds平滑", detail: "有效 Vds 相关平滑参数。用于数值和小 Vds 区域修正。" },
  NSUB: { short: "衬底掺杂", detail: "衬底掺杂浓度。影响阈值和体效应，单曲线拟合中通常与 VTH0/K1 强相关。" },
};

function computeStep(lower: number, upper: number): number {
  const r = Math.abs(upper - lower);
  if (r === 0 || !isFinite(r)) return 0.001;
  if (r >= 1000) return 10;
  if (r >= 100) return 1;
  if (r >= 10) return 0.1;
  if (r >= 1) return 0.01;
  if (r >= 0.1) return 0.001;
  if (r >= 0.01) return 0.0001;
  return r / 100;
}

function fmt(v: number): string {
  if (v === 0) return "0";
  const a = Math.abs(v);
  if (a >= 1e4 || a < 1e-3) return v.toExponential(2);
  return parseFloat(v.toPrecision(4)).toString();
}

interface ParamSlidersProps {
  values: Record<string, number>;
  checked: Set<string>;
  locked?: Set<string>;
  onChange: (name: string, value: number) => void;
  onCheck: (name: string, checked: boolean) => void;
  onToggleLock?: (name: string) => void;
  onReset: (name: string) => void;
  onResetCat: (cat: string) => void;
  bounds?: Record<string, { min?: string; max?: string }>;
  onBoundsChange?: (name: string, next: { min?: string; max?: string }) => void;
  onResetBounds?: (name: string) => void;
  onResetCatBounds?: (cat: string) => void;
  collapsed?: Set<string>;
  onToggle?: (cat: string) => void;
}

/** 解析输入框, 允许空/非数字 => 用 fallback 默认值 */
function parseInput(s: string, fallback: number): number {
  const t = s.trim();
  if (t === "" || t === "-") return fallback;
  const n = parseFloat(t);
  return isFinite(n) ? n : fallback;
}

export function ParamSliders({
  values, checked, locked,
  onChange, onCheck, onReset, onResetCat,
  onToggleLock,
  bounds: externalBounds,
  onBoundsChange,
  onResetBounds,
  onResetCatBounds,
  collapsed,
  onToggle,
}: ParamSlidersProps) {
  // 自定义 bounds: name -> {min, max}
  const [localBounds, setLocalBounds] = useState<Record<string, { min?: string; max?: string }>>({});
  const customBounds = externalBounds ?? localBounds;
  const updateBounds = (name: string, next: { min?: string; max?: string }) => {
    if (onBoundsChange) {
      onBoundsChange(name, next);
    } else {
      setLocalBounds(prev => ({ ...prev, [name]: next }));
    }
  };
  const resetBounds = (name: string) => {
    if (onResetBounds) {
      onResetBounds(name);
    } else {
      setLocalBounds(prev => {
        const n = { ...prev };
        delete n[name];
        return n;
      });
    }
  };
  const resetCatBounds = (cat: string, params: typeof BSIM3_PARAMS) => {
    if (onResetCatBounds) {
      onResetCatBounds(cat);
      return;
    }
    setLocalBounds(prev => {
      const n = { ...prev };
      for (const p of params) delete n[p.name];
      return n;
    });
  };

  const getBounds = (name: string, defaultLo: number, defaultHi: number) => {
    const cb = customBounds[name];
    const lo = cb?.min !== undefined ? parseInput(cb.min, defaultLo) : defaultLo;
    const hi = cb?.max !== undefined ? parseInput(cb.max, defaultHi) : defaultHi;
    return { lo, hi };
  };

  const setCustomMin = (name: string, val: string) => {
    updateBounds(name, { ...customBounds[name], min: val });
  };
  const setCustomMax = (name: string, val: string) => {
    updateBounds(name, { ...customBounds[name], max: val });
  };
  const [hoverParam, setHoverParam] = useState<string | null>(null);
  const hoverTimerRef = useRef<number | null>(null);

  const handleParamMouseEnter = (paramName: string) => {
    hoverTimerRef.current = window.setTimeout(() => {
      setHoverParam(paramName);
    }, 1000); // 1秒延迟
  };

  const handleParamMouseLeave = () => {
    if (hoverTimerRef.current !== null) {
      clearTimeout(hoverTimerRef.current);
      hoverTimerRef.current = null;
    }
    setHoverParam(null);
  };

  useEffect(() => {
    return () => {
      if (hoverTimerRef.current !== null) {
        clearTimeout(hoverTimerRef.current);
      }
    };
  }, []);

  return (
    <div style={{ overflowY: "auto", flex: 1, padding: "0 12px" }}>
      <style>{`
        .param-range {
          appearance: none;
          -webkit-appearance: none;
          height: 7px;
          border-radius: var(--radius-sm);
          outline: none;
        }
        .param-range::-webkit-slider-runnable-track {
          height: 7px;
          border-radius: var(--radius-sm);
          background: transparent;
        }
        .param-range::-webkit-slider-thumb {
          -webkit-appearance: none;
          appearance: none;
          width: 15px;
          height: 15px;
          border-radius: var(--radius-lg);
          background: #ffffff;
          border: 2px solid var(--primary);
          box-shadow: 0 1px 3px rgba(15, 23, 42, 0.22);
          margin-top: -4px;
        }
        .param-range::-moz-range-track {
          height: 7px;
          border-radius: var(--radius-sm);
          background: transparent;
        }
        .param-range::-moz-range-thumb {
          width: 15px;
          height: 15px;
          border-radius: var(--radius-lg);
          background: #ffffff;
          border: 2px solid var(--primary);
          box-shadow: 0 1px 3px rgba(15, 23, 42, 0.22);
        }
      `}</style>
      {CATS.map(cat => {
        const params = BSIM3_PARAMS.filter(p => p.category === cat);
        if (params.length === 0) return null;
        const isCollapsed = collapsed?.has(cat);
        const unlockedParams = params.filter(p => !locked?.has(p.name));
        const checkedCount = unlockedParams.filter(p => checked.has(p.name)).length;
        const allChecked = unlockedParams.length > 0 && checkedCount === unlockedParams.length;
        const someChecked = checkedCount > 0 && !allChecked;

        return (
          <div key={cat} style={{ marginBottom: 16 }}>
            {/* 分类标题行 */}
            <div style={{
              display: "flex", alignItems: "center", gap: 6,
              marginBottom: 6,
            }}>
              <input
                type="checkbox"
                checked={allChecked}
                ref={el => { if (el) el.indeterminate = someChecked; }}
                onChange={e => {
                  for (const p of unlockedParams) onCheck(p.name, e.target.checked);
                }}
                disabled={unlockedParams.length === 0}
                style={{ accentColor: "var(--primary)" }}
                title={`全选/取消 ${cat} 所有参数`}
              />
              {onToggle && (
                <button onClick={() => onToggle(cat)}
                style={{ background: "none", border: "none", cursor: "pointer", padding: "2px 4px", color: "var(--muted)" }}>
                  {isCollapsed ? "+" : "−"}
                </button>
              )}
              <span style={{ fontSize: 13, fontWeight: 700, color: "var(--primary)", textTransform: "uppercase", letterSpacing: "0.05em", flex: 1 }}>
                {cat}
              </span>
              <span style={{ fontSize: 12, color: "var(--muted)" }}>
                {unlockedParams.length === 0 ? "locked" : `${checkedCount}/${unlockedParams.length}`}
              </span>
              <button
                onClick={() => {
                  onResetCat(cat);
                  resetCatBounds(cat, params);
                }}
                title={`Reset ${cat}`}
                style={{ background: "none", border: "none", cursor: "pointer", padding: 2, color: "var(--muted)" }}>
                <RotateCcw size={10} />
              </button>
            </div>

            {!isCollapsed && params.map(p => {
              const cur = values[p.name] ?? p.default;
              const isLocked = locked?.has(p.name) ?? false;
              const isChk = checked.has(p.name) && !isLocked;
              const cn = PARAM_CN[p.name] ?? { short: p.description || p.name, detail: p.description || "暂无详细说明。" };
              // bounds: 优先用用户自定义, 否则默认
              const { lo, hi } = getBounds(p.name, p.lower, p.upper);
              const step = computeStep(lo, hi);
              const hasCustom = customBounds[p.name]?.min !== undefined || customBounds[p.name]?.max !== undefined;
              const clampedValue = Math.max(lo, Math.min(hi, cur));
              const fillPct = hi > lo ? Math.max(0, Math.min(100, ((clampedValue - lo) / (hi - lo)) * 100)) : 0;
              return (
                <div key={p.name} style={{ marginBottom: 4 }}>
                  {/* 第一行: 勾选 + 名称 + 当前值 + reset */}
                  <div style={{ display: "flex", alignItems: "center", gap: 4, marginBottom: 2 }}>
                    <input
                      type="checkbox"
                      checked={isChk}
                      disabled={isLocked}
                      onChange={e => onCheck(p.name, e.target.checked)}
                      style={{ accentColor: "var(--primary)" }}
                      title={isLocked ? "参数已锁住，不参与下一轮拟合" : "勾选后参与下一轮拟合"}
                    />
                    <span
                      onMouseEnter={() => handleParamMouseEnter(p.name)}
                      onMouseLeave={handleParamMouseLeave}
                      style={{
                        fontSize: 13,
                        color: isChk ? "var(--text)" : "var(--muted)",
                        minWidth: 112,
                        fontWeight: 600,
                        display: "inline-flex",
                        alignItems: "center",
                        gap: 4,
                        position: "relative",
                      }}
                    >
                      <span style={{ fontFamily: "monospace" }}>{p.name}</span>
                      {onToggleLock && (
                        <button
                          type="button"
                          onClick={(e) => {
                            e.stopPropagation();
                            onToggleLock(p.name);
                          }}
                          title={isLocked ? "已锁住：点击解锁，允许下一轮拟合改变" : "未锁住：点击锁住，下一轮拟合不改变"}
                          style={{
                            display: "inline-flex",
                            alignItems: "center",
                            justifyContent: "center",
                            width: 16,
                            height: 16,
                            border: 0,
                            borderRadius: "var(--radius-sm)",
                            background: isLocked ? "rgba(245, 158, 11, 0.12)" : "transparent",
                            color: isLocked ? "#b45309" : "var(--muted)",
                            cursor: "pointer",
                            padding: 0,
                            flexShrink: 0,
                          }}
                        >
                          {isLocked ? <Lock size={11} /> : <Unlock size={11} />}
                        </button>
                      )}
                      <span style={{
                        fontSize: 11,
                        color: isLocked ? "#b45309" : isChk ? "var(--primary)" : "var(--muted)",
                        fontFamily: "'Inter', 'Segoe UI', system-ui, sans-serif",
                        whiteSpace: "nowrap",
                      }}>
                        {cn.short}
                      </span>
                      {hoverParam === p.name && (
                        <span style={{
                          position: "absolute",
                          zIndex: 20,
                          left: 0,
                          top: 18,
                          width: 260,
                          padding: "8px 10px",
                          border: "1px solid var(--border)",
                          borderRadius: "var(--radius-lg)",
                          background: "#ffffff",
                          color: "var(--text)",
                          boxShadow: "0 8px 24px rgba(15, 23, 42, 0.16)",
                          fontSize: 13,
                          lineHeight: 1.45,
                          fontWeight: 400,
                          fontFamily: "'Inter', 'Segoe UI', system-ui, sans-serif",
                          pointerEvents: "none",
                        }}>
                          <b style={{ fontFamily: "monospace" }}>{p.name}</b>
                          <span style={{ color: "var(--muted)" }}> · {cn.short}</span>
                          <br />
                          {cn.detail}
                          <br />
                          <span style={{ color: "var(--muted)" }}>
                            默认 {fmt(p.default)} · 范围 [{fmt(p.lower)}, {fmt(p.upper)}]{p.unit ? ` · 单位 ${p.unit}` : ""}
                          </span>
                        </span>
                      )}
                    </span>
                    {p.unit && (
                      <span style={{ fontSize: 11, color: "var(--muted)" }}>{p.unit}</span>
                    )}
                    <span style={{ flex: 1 }} />
                    <span style={{
                      fontSize: 13, fontFamily: "monospace", minWidth: 78,
                      textAlign: "right",
                      color: isLocked ? "#b45309" : isChk ? "var(--primary)" : "var(--muted)",
                      fontWeight: 600,
                    }}>
                      {fmt(cur)}
                    </span>
                    <button onClick={() => {
                      onReset(p.name);
                      resetBounds(p.name);
                    }} title={`Reset ${p.name}`}
                      style={{ background: "none", border: "none", cursor: "pointer", padding: 2, color: "var(--muted)" }}>
                      <RotateCcw size={9} />
                    </button>
                  </div>
                  {/* 第二行: min 输入框 | 滑块 | max 输入框 */}
                  <div style={{ display: "flex", alignItems: "center", gap: 4 }}>
                    <input
                      type="text"
                      value={customBounds[p.name]?.min ?? ""}
                      placeholder={fmt(p.lower)}
                      onChange={e => setCustomMin(p.name, e.target.value)}
                      title={`${p.name} 最小值 (留空=用默认 ${fmt(p.lower)})`}
                      style={{
                        width: 58, fontSize: 11, fontFamily: "monospace",
                        padding: "2px 3px",
                        border: "1px solid var(--border)",
                        borderRadius: "var(--radius-sm)",
                        background: hasCustom && customBounds[p.name]?.min !== undefined ? "#fff" : "var(--surface)",
                        color: hasCustom && customBounds[p.name]?.min !== undefined ? "var(--text)" : "var(--muted)",
                      }}
                    />
                    <input
                      className="param-range"
                      type="range"
                      min={lo} max={hi} step={step}
                      value={clampedValue}
                      onChange={e => onChange(p.name, parseFloat(e.target.value))}
                      style={{
                        flex: 1, cursor: "pointer",
                        background: `linear-gradient(to right, var(--primary) 0%, var(--primary) ${fillPct}%, #d5dbe3 ${fillPct}%, #d5dbe3 100%)`,
                      }}
                    />
                    <input
                      type="text"
                      value={customBounds[p.name]?.max ?? ""}
                      placeholder={fmt(p.upper)}
                      onChange={e => setCustomMax(p.name, e.target.value)}
                      title={`${p.name} 最大值 (留空=用默认 ${fmt(p.upper)})`}
                      style={{
                        width: 58, fontSize: 11, fontFamily: "monospace",
                        padding: "2px 3px",
                        border: "1px solid var(--border)",
                        borderRadius: "var(--radius-sm)",
                        background: hasCustom && customBounds[p.name]?.max !== undefined ? "#fff" : "var(--surface)",
                        color: hasCustom && customBounds[p.name]?.max !== undefined ? "var(--text)" : "var(--muted)",
                      }}
                    />
                  </div>
                </div>
              );
            })}
          </div>
        );
      })}
    </div>
  );
}
