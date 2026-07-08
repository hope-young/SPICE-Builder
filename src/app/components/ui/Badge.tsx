// Badge.tsx - 标签
import React from "react";
import { cn } from "../../../lib/utils";

interface BadgeProps {
  children: React.ReactNode;
  variant?: "default" | "primary" | "success" | "warning" | "error";
  style?: React.CSSProperties;
  className?: string;
  onClick?: () => void;
}

export function Badge({ children, variant = "default", style, className, onClick }: BadgeProps) {
  const variants: Record<string, React.CSSProperties> = {
    default: { background: "var(--hover)", color: "var(--muted)" },
    primary: { background: "var(--accent)", color: "var(--primary)" },
    success: { background: "var(--success)", color: "#fff" },
    warning: { background: "var(--warning)", color: "#2c2c2c" },
    error: { background: "var(--error)", color: "#fff" },
  };
  return (
    <span
      onClick={onClick}
      style={{
        display: "inline-flex",
        alignItems: "center",
        padding: "1px 6px",
        borderRadius: "var(--radius-sm)",
        fontSize: 10,
        fontWeight: 500,
        fontFamily: "'Inter', 'Segoe UI', system-ui, sans-serif",
        cursor: onClick ? "pointer" : "default",
        ...variants[variant],
        ...style,
      }}
      className={cn(className)}
    >
      {children}
    </span>
  );
}
