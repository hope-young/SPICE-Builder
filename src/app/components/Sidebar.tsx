// Sidebar.tsx - 侧边栏（216px 宽，8 项导航）
import {
  LayoutDashboard, Database, TrendingUp, Cpu, Sliders,
  CheckCircle2, Download, Settings, Zap, ChevronRight, FolderOpen,
  Activity
} from "lucide-react";
import type { NavSection } from "../../lib/types";
import { useApp } from "../../lib/store";

interface NavItem {
  id: NavSection;
  label: string;
  icon: React.ComponentType<{ size?: number | string; color?: string }>;
}

const navItems: NavItem[] = [
  { id: "workbench", label: "Workbench",  icon: Zap },
  { id: "explore",   label: "Explore",    icon: Activity },
  { id: "settings",  label: "Settings",   icon: Settings },
];

interface SidebarProps {
  activeNav: NavSection;
  onNavChange: (nav: NavSection) => void;
}

export function Sidebar({ activeNav, onNavChange }: SidebarProps) {
  const { projectId, dataset, backendRunning } = useApp();
  const partNumber = dataset?.device_info?.part_number ?? null;
  return (
    <div
      style={{
        width: 216,
        minWidth: 216,
        backgroundColor: "var(--surface)",
        borderRight: "1px solid var(--border)",
        display: "flex",
        flexDirection: "column",
        fontFamily: "'Inter', 'Segoe UI', system-ui, sans-serif",
        userSelect: "none",
      }}
    >
      {/* Logo */}
      <div style={{ padding: "14px 14px 12px", borderBottom: "1px solid var(--border)" }}>
        <div style={{ display: "flex", alignItems: "center", gap: 9 }}>
          <div
            style={{
              width: 28,
              height: 28,
              background: "linear-gradient(135deg, var(--primary) 0%, #0077cc 100%)",
              borderRadius: 7,
              display: "flex",
              alignItems: "center",
              justifyContent: "center",
              boxShadow: "0 1px 3px rgba(13,153,255,0.3)",
            }}
          >
            <Zap size={15} color="white" />
          </div>
          <div>
            <div style={{ fontSize: 14, fontWeight: 600, color: "var(--text)", letterSpacing: "-0.01em" }}>
              SpiceBuilder
            </div>
            <div style={{ fontSize: 10, color: "var(--muted)", marginTop: 1 }}>v0.1.0  •  BSIM3v3</div>
          </div>
        </div>
      </div>

      {/* Active project */}
      <div style={{ padding: "8px 10px", borderBottom: "1px solid var(--border)" }}>
        <div
          style={{
            fontSize: 10,
            color: "var(--muted)",
            marginBottom: 4,
            paddingLeft: 2,
            textTransform: "uppercase",
            letterSpacing: "0.05em",
          }}
        >
          Project
        </div>
        <button
          style={{
            width: "100%",
            display: "flex",
            alignItems: "center",
            gap: 6,
            padding: "6px 8px",
            borderRadius: 5,
            backgroundColor: "var(--hover)",
            border: "1px solid var(--border)",
            cursor: "pointer",
            textAlign: "left",
          }}
        >
          <FolderOpen size={13} color="var(--muted)" />
          <div style={{ flex: 1, overflow: "hidden" }}>
            <div
              style={{
                fontSize: 12,
                color: "var(--text)",
                fontWeight: 500,
                overflow: "hidden",
                textOverflow: "ellipsis",
                whiteSpace: "nowrap",
              }}
            >
              {partNumber ?? (projectId ? `Project ${projectId.slice(0,8)}` : "No project loaded")}
            </div>
          </div>
          <div
            style={{
              width: 7,
              height: 7,
              borderRadius: "50%",
              backgroundColor: "var(--success)",
              flexShrink: 0,
            }}
          />
        </button>
      </div>

      {/* Navigation */}
      <nav style={{ flex: 1, padding: "8px 8px", overflowY: "auto" }}>
        {navItems.map((item) => (
          <NavItem key={item.id} item={item} active={activeNav === item.id} onClick={() => onNavChange(item.id)} />
        ))}
      </nav>

      {/* Status footer */}
      <div style={{ padding: "10px 12px", borderTop: "1px solid var(--border)" }}>
        <div style={{ display: "flex", alignItems: "center", gap: 6, marginBottom: 4 }}>
        <div style={{ width: 6, height: 6, borderRadius: "50%", backgroundColor: backendRunning ? "var(--success)" : "var(--error)" }} />
        <span style={{ fontSize: 11, color: backendRunning ? "var(--success)" : "var(--error)", fontWeight: 500 }}>
          {backendRunning ? "Python backend running" : "Python backend offline"}
        </span>
        </div>
        <div style={{ fontSize: 10, color: "var(--muted)" }}>Si SGT MOSFET  ·  &lt;200V</div>
      </div>
    </div>
  );
}

function NavItem({ item, active, onClick }: { item: NavItem; active: boolean; onClick: () => void }) {
  const Icon = item.icon;
  return (
    <button
      onClick={onClick}
      style={{
        width: "100%",
        display: "flex",
        alignItems: "center",
        gap: 8,
        padding: "6px 10px",
        borderRadius: 5,
        border: "none",
        cursor: "pointer",
        marginBottom: 1,
        backgroundColor: active ? "var(--accent)" : "transparent",
        color: active ? "var(--primary)" : "var(--text)",
        fontSize: 13,
        fontWeight: active ? 500 : 400,
        transition: "background-color 0.08s ease",
        textAlign: "left",
        fontFamily: "'Inter', 'Segoe UI', system-ui, sans-serif",
      }}
      onMouseEnter={(e) => {
        if (!active) (e.currentTarget as HTMLElement).style.backgroundColor = "var(--hover)";
      }}
      onMouseLeave={(e) => {
        if (!active) (e.currentTarget as HTMLElement).style.backgroundColor = "transparent";
      }}
    >
      <Icon size={15} color={active ? "var(--primary)" : "var(--muted)"} />
      <span style={{ flex: 1 }}>{item.label}</span>
      {active && <ChevronRight size={12} color="var(--primary)" />}
    </button>
  );
}
