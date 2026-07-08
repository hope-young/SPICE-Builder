// Button.tsx - 简化按钮
import React from "react";
import { cn } from "../../../lib/utils";

interface ButtonProps extends React.ButtonHTMLAttributes<HTMLButtonElement> {
  variant?: "primary" | "outline" | "ghost" | "danger";
  size?: "sm" | "md";
  children: React.ReactNode;
}

export function Button({
  variant = "primary",
  size = "md",
  className,
  style,
  children,
  ...props
}: ButtonProps) {
  const styles: React.CSSProperties = {
    display: "inline-flex",
    alignItems: "center",
    justifyContent: "center",
    gap: 6,
    padding: size === "sm" ? "4px 10px" : "6px 14px",
    borderRadius: "var(--radius-md)",
    border: "none",
    cursor: props.disabled ? "not-allowed" : "pointer",
    fontSize: 12,
    fontWeight: 500,
    fontFamily: "'Inter', 'Segoe UI', system-ui, sans-serif",
    transition: "background-color 0.1s",
    opacity: props.disabled ? 0.5 : 1,
    ...style,
  };

  switch (variant) {
    case "primary":
      return (
        <button
          {...props}
          style={{ ...styles, background: "var(--primary)", color: "#fff" }}
          className={cn(className)}
        >
          {children}
        </button>
      );
    case "outline":
      return (
        <button
          {...props}
          style={{ ...styles, background: "var(--bg)", color: "var(--text)", border: "1px solid var(--border)" }}
          className={cn(className)}
        >
          {children}
        </button>
      );
    case "ghost":
      return (
        <button
          {...props}
          style={{ ...styles, background: "transparent", color: "var(--text)" }}
          className={cn(className)}
        >
          {children}
        </button>
      );
    case "danger":
      return (
        <button
          {...props}
          style={{ ...styles, background: "var(--error)", color: "#fff" }}
          className={cn(className)}
        >
          {children}
        </button>
      );
  }
}
