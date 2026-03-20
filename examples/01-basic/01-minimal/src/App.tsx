import { useState } from "react";
import { CollabDemo } from "./CollabDemo";
import { ForkDemo } from "./ForkDemo";
import { ConversionsDemo } from "./ConversionsDemo";
import { AIDemo } from "./AIDemo";

const TABS = [
  { id: "collab", label: "Sync + Cursors + Undo + Comments", component: CollabDemo },
  { id: "fork", label: "ForkYDoc", component: ForkDemo },
  { id: "conversions", label: "Yjs Conversions", component: ConversionsDemo },
  { id: "ai", label: "AI Extension", component: AIDemo },
] as const;

export default function App() {
  const [activeTab, setActiveTab] = useState<string>("collab");

  const ActiveComponent =
    TABS.find((t) => t.id === activeTab)?.component ?? CollabDemo;

  return (
    <div style={{ fontFamily: "system-ui, sans-serif" }}>
      <nav
        style={{
          display: "flex",
          gap: "0",
          borderBottom: "2px solid #e2e8f0",
          padding: "0 20px",
          background: "#f8fafc",
        }}
      >
        {TABS.map((tab) => (
          <button
            key={tab.id}
            onClick={() => setActiveTab(tab.id)}
            style={{
              padding: "12px 20px",
              border: "none",
              borderBottom:
                activeTab === tab.id
                  ? "2px solid #3b82f6"
                  : "2px solid transparent",
              background: activeTab === tab.id ? "white" : "transparent",
              color: activeTab === tab.id ? "#1e293b" : "#64748b",
              fontWeight: activeTab === tab.id ? 600 : 400,
              fontSize: "14px",
              cursor: "pointer",
              marginBottom: "-2px",
              transition: "all 0.15s",
            }}
          >
            {tab.label}
          </button>
        ))}
      </nav>
      <ActiveComponent />
    </div>
  );
}
