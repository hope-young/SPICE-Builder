import {
  LayoutDashboard, Database, TrendingUp, Cpu, Sliders,
  CheckCircle2, Download, Settings, Zap, ChevronRight, FolderOpen
} from "lucide-react";

export type NavSection =
  | "dashboard" | "data" | "curve" | "model"
  | "fitting" | "validate" | "export" | "settings";

const navItems: { id: NavSection; label: string; icon: React.ComponentType<{ size?: number; color?: string }> }[] = [
  { id: "dashboard", label: "Dashboard", icon: LayoutDashboard },
  { id: "data",      label: "Data",      icon: Database },
  { id: "curve",     label: "Curve",     icon: TrendingUp },
  { id: "model",     label: "Model",     icon: Cpu },
  { id: "fitting",   label: "Fitting",   icon: Sliders },
  { id: "validate",  label: "Validate",  icon: CheckCircle2 },
  { id: "export",    label: "Export",    icon: Download },
  { id: "settings",  label: "Settings",  icon: Settings },
];

interface SidebarProps {
  activeNav: NavSection;
  onNavChange: (nav: NavSection) => void;
}

export function Sidebar({ activeNav, onNavChange }: SidebarProps) {
  return (
    <div style={{
      width: 216,
      minWidth: 216,
      backgroundColor: "#fafafa",
      borderRight: "1px solid #e5e5e5",
      display: "flex",
      flexDirection: "column",
      fontFamily: "'Inter', 'Segoe UI', system-ui, sans-serif",
      userSelect: "none",
    }}>
      {/* Logo */}
      <div style={{ padding: "14px 14px 12px", borderBottom: "1px solid #e5e5e5" }}>
        <div style={{ display: "flex", alignItems: "center", gap: 9 }}>
          <div style={{
            width: 28, height: 28,
            background: "linear-gradient(135deg, #0d99ff 0%, #0077cc 100%)",
            borderRadius: 7,
            display: "flex", alignItems: "center", justifyContent: "center",
            boxShadow: "0 1px 3px rgba(13,153,255,0.3)",
          }}>
            <Zap size={15} color="white" />
          </div>
          <div>
            <div style={{ fontSize: 14, fontWeight: 600, color: "#2c2c2c", letterSpacing: "-0.01em" }}>SpiceBuilder</div>
            <div style={{ fontSize: 10, color: "#6b7280", marginTop: 1 }}>v2.4.1  •  BSIM3v3</div>
          </div>
        </div>
      </div>

      {/* Active project */}
      <div style={{ padding: "8px 10px", borderBottom: "1px solid #e5e5e5" }}>
        <div style={{ fontSize: 10, color: "#6b7280", marginBottom: 4, paddingLeft: 2, textTransform: "uppercase", letterSpacing: "0.05em" }}>Project</div>
        <button style={{
          width: "100%",
          display: "flex", alignItems: "center", gap: 6,
          padding: "6px 8px", borderRadius: 5,
          backgroundColor: "#f5f5f5",
          border: "1px solid #e5e5e5",
          cursor: "pointer",
          textAlign: "left",
        }}>
          <FolderOpen size={13} color="#6b7280" />
          <div style={{ flex: 1, overflow: "hidden" }}>
            <div style={{ fontSize: 12, color: "#2c2c2c", fontWeight: 500, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>
              IRFS4321_25C
            </div>
          </div>
          <div style={{ width: 7, height: 7, borderRadius: "50%", backgroundColor: "#14ae5c", flexShrink: 0 }} />
        </button>
      </div>

      {/* Navigation */}
      <nav style={{ flex: 1, padding: "8px 8px", overflowY: "auto" }}>
        <div style={{ fontSize: 10, color: "#6b7280", marginBottom: 4, paddingLeft: 4, textTransform: "uppercase", letterSpacing: "0.05em" }}>Workflow</div>
        {navItems.slice(0, 6).map(item => <NavItem key={item.id} item={item} active={activeNav === item.id} onClick={() => onNavChange(item.id)} />)}

        <div style={{ fontSize: 10, color: "#6b7280", marginTop: 12, marginBottom: 4, paddingLeft: 4, textTransform: "uppercase", letterSpacing: "0.05em" }}>Output</div>
        {navItems.slice(6).map(item => <NavItem key={item.id} item={item} active={activeNav === item.id} onClick={() => onNavChange(item.id)} />)}
      </nav>

      {/* Status footer */}
      <div style={{ padding: "10px 12px", borderTop: "1px solid #e5e5e5" }}>
        <div style={{ display: "flex", alignItems: "center", gap: 6, marginBottom: 4 }}>
          <div style={{ width: 6, height: 6, borderRadius: "50%", backgroundColor: "#14ae5c" }} />
          <span style={{ fontSize: 11, color: "#14ae5c", fontWeight: 500 }}>LTspice Connected</span>
        </div>
        <div style={{ fontSize: 10, color: "#6b7280" }}>Si SGT MOSFET  ·  &lt;200V</div>
      </div>
    </div>
  );
}

function NavItem({
  item, active, onClick
}: {
  item: typeof navItems[0];
  active: boolean;
  onClick: () => void;
}) {
  const Icon = item.icon;
  return (
    <button
      onClick={onClick}
      style={{
        width: "100%",
        display: "flex", alignItems: "center", gap: 8,
        padding: "6px 10px",
        borderRadius: 5,
        border: "none",
        cursor: "pointer",
        marginBottom: 1,
        backgroundColor: active ? "#e6f4ff" : "transparent",
        color: active ? "#0d99ff" : "#2c2c2c",
        fontSize: 13,
        fontWeight: active ? 500 : 400,
        transition: "background-color 0.08s ease",
        textAlign: "left",
        fontFamily: "'Inter', 'Segoe UI', system-ui, sans-serif",
      }}
      onMouseEnter={e => { if (!active) (e.currentTarget as HTMLElement).style.backgroundColor = "#f5f5f5"; }}
      onMouseLeave={e => { if (!active) (e.currentTarget as HTMLElement).style.backgroundColor = "transparent"; }}
    >
      <Icon size={15} color={active ? "#0d99ff" : "#6b7280"} />
      <span style={{ flex: 1 }}>{item.label}</span>
      {active && <ChevronRight size={12} color="#0d99ff" />}
    </button>
  );
}
