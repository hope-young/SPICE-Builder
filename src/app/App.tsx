// App.tsx - 主入口
// 顶部：项目名 + 菜单栏（文件/编辑/视图/拟合/工具/帮助，"工具" 集合原 Settings 入口）
// 主体：常驻三张页面（Workbench / Explore / Settings），Workbench 接管 TransFit 功能
import { useState, useEffect, useRef } from "react";
import type { ReactNode } from "react";
import { SettingsScreen } from "./components/SettingsScreen";
import { ParamExplorer } from "./components/ParamExplorer";
import { LogPanel } from "./components/LogPanel";
import { Workbench } from "./components/Workbench";
import { AppProvider, useApp } from "../lib/store";
import type { NavSection } from "../lib/types";
import { dispatchWorkbenchAction, type WorkbenchAction } from "../lib/events";

const MENUBAR_HEIGHT = 26;

interface MenuDef {
  label: string;
  items: (string | { label: string; navTo?: NavSection; action?: string })[];
  highlightWhen?: NavSection;
}

const MENUS: MenuDef[] = [
  {
    label: "文件",
    items: ["新建项目", "打开项目", "—", "导入 CSV / Excel", "—", "保存模型", "导出 SPICE .lib"],
  },
  {
    label: "编辑",
    items: ["撤销 Ctrl+Z", "重做 Ctrl+Y", "—", "复制参数", "粘贴参数", "—", "重置全部参数"],
  },
  {
    label: "视图",
    items: [
      { label: "Workbench 工作台",       navTo: "workbench" },
      { label: "TransFit 单曲线拟合 → Workbench", navTo: "workbench" },
      { label: "Explore 参数探索",       navTo: "explore" },
      { label: "Settings 设置",          navTo: "settings" },
      "—",
      "显示/隐藏 Convergence",
      "显示/隐藏 Fit Queue",
    ],
  },
  {
    label: "拟合",
    items: ["仿真当前项 F5", "拟合勾选项 F7", "拟合全部队列 F8", "—", "停止拟合 Esc", "重置停止条件"],
  },
  {
    label: "工具",
    items: [
      { label: "LTspice 路径设置",     navTo: "settings" },
      { label: "网格提取工具" },
      { label: "参数灵敏度分析" },
      "—",
      { label: "日志查看器",         navTo: "settings" },
    ],
    highlightWhen: "settings",
  },
  {
    label: "帮助",
    items: ["文档", "快捷键", "—", "关于 SpiceBuilder v2.4.1"],
  },
];

function MenuBar({
  activeNav,
  onPickMenu,
}: {
  activeNav: NavSection;
  onPickMenu: (menuLabel: string, itemLabel: string, navTo?: NavSection) => void;
}) {
  const [openLabel, setOpenLabel] = useState<string | null>(null);
  const barRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    const onDocDown = (e: MouseEvent) => {
      if (!barRef.current) return;
      if (!barRef.current.contains(e.target as Node)) setOpenLabel(null);
    };
    document.addEventListener("mousedown", onDocDown);
    return () => document.removeEventListener("mousedown", onDocDown);
  }, []);

  return (
    <div
      ref={barRef}
      style={{
        height: MENUBAR_HEIGHT,
        flexShrink: 0,
        display: "flex",
        alignItems: "center",
        paddingLeft: 8,
        background: "var(--surface)",
        borderBottom: "1px solid var(--border)",
        userSelect: "none",
        fontSize: 12,
      }}
    >
      {MENUS.map((m) => {
        const highlight =
          (m.highlightWhen ? m.highlightWhen === activeNav : false);
        return (
          <MenuDropdown
            key={m.label}
            label={m.label}
            items={m.items}
            isOpen={openLabel === m.label}
            highlight={highlight}
            onToggle={() =>
              setOpenLabel((cur) => (cur === m.label ? null : m.label))
            }
            onPick={(itemLabel, navTo) => {
              setOpenLabel(null);
              onPickMenu(m.label, itemLabel, navTo);
            }}
          />
        );
      })}
    </div>
  );
}


function MenuDropdown({
  label, items, isOpen, highlight, onToggle, onPick,
}: {
  label: string;
  items: MenuDef["items"];
  isOpen: boolean;
  highlight: boolean;
  onToggle: () => void;
  onPick: (itemLabel: string, navTo?: NavSection) => void;
}) {
  const wrapRef = useRef<HTMLDivElement>(null);
  return (
    <div ref={wrapRef} style={{ position: "relative" }}>
      <button
        type="button"
        onClick={onToggle}
        style={{
          height: MENUBAR_HEIGHT,
          padding: "0 10px",
          border: "none",
          background: isOpen || highlight ? "var(--accent)" : "transparent",
          color: isOpen || highlight ? "var(--primary)" : "var(--text)",
          cursor: "pointer",
          fontSize: 12,
          fontWeight: 500,
        }}
      >
        {label}
      </button>
      {isOpen && (
        <div
          style={{
            position: "absolute",
            top: MENUBAR_HEIGHT,
            left: 0,
            zIndex: 2000,
            background: "var(--surface)",
            border: "1px solid var(--border)",
            borderRadius: "var(--radius-sm)",
            boxShadow: "0 2px 8px rgba(0,0,0,0.12)",
            minWidth: 220,
            padding: "3px 0",
            pointerEvents: "auto",
          }}
        >
          {items.map((it, i) => {
            if (it === "—") {
              return (
                <div
                  key={`sep-${label}-${i}`}
                  style={{
                    height: 1,
                    background: "var(--border)",
                    margin: "3px 0",
                  }}
                />
              );
            }
            const itemLabel = typeof it === "string" ? it : it.label;
            const navTo = typeof it === "string" ? undefined : it.navTo;
            return (
              <button
                key={itemLabel}
                type="button"
                onClick={() => onPick(itemLabel, navTo)}
                style={{
                  display: "block",
                  width: "100%",
                  textAlign: "left",
                  padding: "5px 14px",
                  border: "none",
                  background: "transparent",
                  cursor: "pointer",
                  fontSize: 12,
                  color: "var(--text)",
                  pointerEvents: "auto",
                }}
                onMouseEnter={(e) =>
                  ((e.currentTarget as HTMLElement).style.background = "var(--accent)")
                }
                onMouseLeave={(e) =>
                  ((e.currentTarget as HTMLElement).style.background = "transparent")
                }
              >
                {itemLabel}
              </button>
            );
          })}
        </div>
      )}
    </div>
  );
}

function AppInner() {
  const [activeNav, setActiveNav] = useState<NavSection>("workbench");
  const { refreshBackend } = useApp();
  useEffect(() => {
    refreshBackend().catch((e) => {
      console.warn("startup refreshBackend failed:", e);
    });
    const onFocus = () => {
      refreshBackend().catch(() => undefined);
    };
    window.addEventListener("focus", onFocus);
    return () => window.removeEventListener("focus", onFocus);
  }, [refreshBackend]);

  const handlePick = (
    _menu: string,
    _item: string,
    navTo?: NavSection,
  ) => {
    if (navTo) return setActiveNav(navTo);
    if (activeNav === "workbench") {
      if (_item.includes("导入 CSV")) dispatchWorkbenchAction("import");
      if (_item.includes("导出 SPICE")) dispatchWorkbenchAction("export");
      if (_item.includes("仿真当前项")) dispatchWorkbenchAction("simulate");
      if (_item.includes("拟合勾选项") || _item.includes("拟合全部队列")) dispatchWorkbenchAction("fit-selected");
      if (_item.includes("停止拟合")) dispatchWorkbenchAction("stop");
    }
    console.info(`[Menu] ${_menu} -> ${_item}`);
  };

  return (
    <div
      style={{
        display: "flex",
        flexDirection: "column",
        width: "100vw",
        height: "100vh",
        overflow: "hidden",
        fontFamily: "'Inter', 'Segoe UI', system-ui, sans-serif",
        backgroundColor: "var(--bg)",
        color: "var(--text)",
        fontSize: 13,
      }}
    >
      <MenuBar activeNav={activeNav} onPickMenu={handlePick} />
      <main
        style={{
          flex: 1, minHeight: 0, overflow: "hidden",
          display: "flex", flexDirection: "column",
        }}
      >
        <div style={{ flex: 1, overflow: "hidden", position: "relative" }}>
          {/* 所有页面常驻内存, 切换仅隐藏, state 完整保留 */}
          <div
            style={{
              position: "absolute", inset: 0,
              display: activeNav === "workbench" ? "flex" : "none",
              flexDirection: "column",
              pointerEvents: "auto",
            }}
          >
            <Workbench
              onOpenSettings={() => setActiveNav("settings")}
              onOpenFitting={() => setActiveNav("workbench")}
            />
          </div>

          <div
            style={{
              position: "absolute", inset: 0,
              display: activeNav === "explore" ? "flex" : "none",
              flexDirection: "column",
              pointerEvents: "auto",
            }}
          >
            <ParamExplorer />
          </div>
          <div
            style={{
              position: "absolute", inset: 0,
              display: activeNav === "settings" ? "flex" : "none",
              flexDirection: "column",
              pointerEvents: "auto",
            }}
          >
            <SettingsScreen />
          </div>
        </div>
        <LogPanel />
      </main>
    </div>
  );
}

export default function App() {
  return (
    <AppProvider>
      <AppInner />
    </AppProvider>
  );
}
