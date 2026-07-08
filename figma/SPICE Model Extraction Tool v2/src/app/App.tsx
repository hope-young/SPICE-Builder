import { useState } from "react";
import { Sidebar, type NavSection } from "./components/Sidebar";
import { Dashboard } from "./components/Dashboard";
import { DataBrowser } from "./components/DataBrowser";
import { CurveVisualizer } from "./components/CurveVisualizer";
import { FittingPipeline } from "./components/FittingPipeline";
import { ModelEditor } from "./components/ModelEditor";
import { ValidateScreen } from "./components/ValidateScreen";
import { ExportScreen } from "./components/ExportScreen";
import { SettingsScreen } from "./components/SettingsScreen";
import { Workbench } from "./components/Workbench";

export default function App() {
  /* MARKER-MAKE-KIT-INVOKED */
  const [activeNav, setActiveNav] = useState<NavSection>("dashboard");

  return (
    <div style={{
      display: "flex",
      width: "100vw",
      height: "100vh",
      overflow: "hidden",
      fontFamily: "'Inter', 'Segoe UI', system-ui, sans-serif",
      backgroundColor: "#ffffff",
      fontSize: 13,
    }}>
      <Sidebar activeNav={activeNav} onNavChange={setActiveNav} />
      <main style={{ flex: 1, overflow: "hidden", display: "flex", flexDirection: "column" }}>
        {activeNav === "dashboard" && <Dashboard />}
        {activeNav === "data"      && <DataBrowser />}
        {activeNav === "curve"     && <CurveVisualizer />}
        {activeNav === "model"     && <ModelEditor />}
        {activeNav === "workbench" && <Workbench />}
        {activeNav === "fitting"   && <FittingPipeline />}
        {activeNav === "validate"  && <ValidateScreen />}
        {activeNav === "export"    && <ExportScreen />}
        {activeNav === "settings"  && <SettingsScreen />}
      </main>
    </div>
  );
}
