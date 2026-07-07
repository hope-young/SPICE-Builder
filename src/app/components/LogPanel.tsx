// LogPanel.tsx - 底部日志栏，从 store.logs 拉数据
import { useState, useRef, useEffect, useMemo } from "react";
import { ChevronUp, ChevronDown, Trash2, Pause, Play, Filter } from "lucide-react";
import { useApp } from "../../lib/store";

const LEVEL_COLOR: Record<string, string> = {
  info: "#3b82f6",
  warn: "#f59e0b",
  error: "#ef4444",
  success: "#10b981",
};

const LEVEL_RANK: Record<string, number> = {
  info: 0, warn: 1, error: 2, success: 1,
};

type LogEntry = { ts: string; level: string; msg: string };

const FILTER_OPTIONS: Array<{ label: string; minRank: number }> = [
  { label: "all",        minRank: 0 },
  { label: "warn+",      minRank: 1 },
  { label: "error only", minRank: 2 },
];

export function LogPanel() {
  const { setLog, subscribeLogs } = useApp();
  const [logs, setLocalLogs] = useState<LogEntry[]>([]);
  const [collapsed, setCollapsed] = useState(false);
  const [paused, setPaused] = useState(false);
  const [buffer, setBuffer] = useState<LogEntry[]>([]);
  const [filterLabel, setFilterLabel] = useState<string>("all");
  const bottomRef = useRef<HTMLDivElement>(null);
  const prevCountRef = useRef(0);

  // 订阅 store logs (不触发外层 re-render, 因为只在 LogPanel 内部 setState)
  useEffect(() => {
    return subscribeLogs((all) => {
      setLocalLogs(all);
    });
  }, [subscribeLogs]);

  const minRank = useMemo(
    () => FILTER_OPTIONS.find(o => o.label === filterLabel)?.minRank ?? 0,
    [filterLabel],
  );

  // 暂停模式下,新 logs 累积到 buffer
  useEffect(() => {
    if (paused) {
      setBuffer(buf => [...buf.slice(-500), ...logs.slice(prevCountRef.current)]);
    }
    prevCountRef.current = logs.length;
  }, [logs, paused]);

  // 自动滚到底
  useEffect(() => {
    if (collapsed || paused) return;
    bottomRef.current?.scrollIntoView({ behavior: "smooth", block: "end" });
  }, [logs, collapsed, paused]);

  const visibleLogs = useMemo(() => {
    const base = paused ? buffer : logs;
    return base.filter(log => (LEVEL_RANK[log.level] ?? 0) >= minRank);
  }, [paused, buffer, logs, minRank]);

  const clearLog = () => setLog("info", "[log cleared]");

  if (logs.length === 0 && buffer.length === 0) {
    return null;
  }

  return (
    <div style={{
      borderTop: "1px solid var(--border)",
      background: "var(--surface)",
      fontFamily: "'Inter', 'Segoe UI', system-ui, sans-serif",
      display: "flex",
      flexDirection: "column",
      flexShrink: 0,
    }}>
      {/* Header */}
      <div style={{
        display: "flex", alignItems: "center", gap: 8,
        padding: "6px 12px",
        borderBottom: collapsed ? "none" : "1px solid var(--border)",
        fontSize: 11,
        color: "var(--muted)",
      }}>
        <button
          onClick={() => setCollapsed(c => !c)}
          style={{ background: "none", border: "none", cursor: "pointer", padding: 2, color: "var(--muted)", display: "flex" }}
          title={collapsed ? "展开日志" : "收起日志"}
        >
          {collapsed ? <ChevronUp size={12} /> : <ChevronDown size={12} />}
        </button>
        <span style={{ fontWeight: 600, color: "var(--text)" }}>日志</span>
        <span style={{
          padding: "1px 6px",
          borderRadius: 8,
          background: "var(--hover)",
          fontSize: 10,
          fontFamily: "monospace",
        }}>
          {visibleLogs.length}
          {paused && buffer.length > logs.length && ` (+${buffer.length - logs.length})`}
        </span>

        {/* 级别过滤 */}
        <div style={{ display: "flex", alignItems: "center", gap: 4, fontSize: 10 }}>
          <Filter size={10} color="var(--muted)" />
          {FILTER_OPTIONS.map(opt => (
            <button
              key={opt.label}
              onClick={() => setFilterLabel(opt.label)}
              style={{
                background: filterLabel === opt.label ? "var(--accent)" : "transparent",
                border: "1px solid var(--border)",
                borderRadius: 3,
                padding: "1px 5px",
                fontSize: 9,
                cursor: "pointer",
                color: filterLabel === opt.label ? "var(--primary)" : "var(--muted)",
              }}
            >
              {opt.label}
            </button>
          ))}
        </div>

        <div style={{ flex: 1 }} />
        <button
          onClick={() => setPaused(p => !p)}
          style={{ background: "none", border: "none", cursor: "pointer", padding: 2, color: paused ? "var(--warning)" : "var(--muted)", display: "flex" }}
          title={paused ? "继续" : "暂停"}
        >
          {paused ? <Play size={11} /> : <Pause size={11} />}
        </button>
        <button
          onClick={clearLog}
          style={{ background: "none", border: "none", cursor: "pointer", padding: 2, color: "var(--muted)", display: "flex" }}
          title="清空"
        >
          <Trash2 size={11} />
        </button>
      </div>

      {/* Log lines */}
      {!collapsed && (
        <div style={{
          maxHeight: 140,
          minHeight: 140,
          overflowY: "auto",
          padding: "6px 12px",
          fontFamily: "monospace",
          fontSize: 11,
          lineHeight: 1.5,
          background: "#ffffff",
          color: "#1f2937",
          borderTop: "1px solid var(--border)",
        }}>
          {visibleLogs.length === 0 ? (
            <div style={{ color: "#9ca3af", fontStyle: "italic" }}>(empty)</div>
          ) : visibleLogs.map((log, i) => {
            const ts = log.ts?.slice(11, 19) ?? "";
            const color = LEVEL_COLOR[log.level] || "#1f2937";
            return (
              <div key={i} style={{ display: "flex", gap: 8 }}>
                <span style={{ color: "#9ca3af", flexShrink: 0 }}>{ts}</span>
                <span style={{ color, flexShrink: 0, fontWeight: 600, minWidth: 50 }}>
                  [{log.level.toUpperCase()}]
                </span>
                <span style={{ flex: 1, wordBreak: "break-word" }}>{log.msg}</span>
              </div>
            );
          })}
          <div ref={bottomRef} />
        </div>
      )}
    </div>
  );
}
