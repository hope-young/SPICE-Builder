// Card.tsx - 卡片
import React from "react";
import { cn } from "../../../lib/utils";

interface CardProps {
  className?: string;
  style?: React.CSSProperties;
  children: React.ReactNode;
  onClick?: () => void;
}

export function Card({ className, style, children, onClick }: CardProps) {
  return (
    <div
      onClick={onClick}
      style={{
        background: "var(--surface)",
        border: "1px solid var(--border)",
        borderRadius: "var(--radius-lg)",
        padding: 14,
        cursor: onClick ? "pointer" : "default",
        transition: "box-shadow 0.1s",
        ...style,
      }}
      className={cn(className)}
    >
      {children}
    </div>
  );
}

interface CardHeaderProps {
  title: string;
  subtitle?: string;
  action?: React.ReactNode;
  style?: React.CSSProperties;
}

export function CardHeader({ title, subtitle, action, style }: CardHeaderProps) {
  return (
    <div
      style={{
        display: "flex",
        alignItems: "center",
        justifyContent: "space-between",
        marginBottom: subtitle ? 4 : 12,
        ...style,
      }}
    >
      <div>
        <div style={{ fontSize: 13, fontWeight: 600, color: "var(--text)" }}>{title}</div>
        {subtitle && (
          <div style={{ fontSize: 11, color: "var(--muted)", marginTop: 2 }}>{subtitle}</div>
        )}
      </div>
      {action}
    </div>
  );
}
