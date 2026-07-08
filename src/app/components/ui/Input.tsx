// Input.tsx - 输入框
import React from "react";
import { cn } from "../../../lib/utils";

interface InputProps extends Omit<React.InputHTMLAttributes<HTMLInputElement>, "size"> {
  size?: "sm" | "md";
}

export const Input = React.forwardRef<HTMLInputElement, InputProps>(
  ({ size = "md", className, style, ...props }, ref) => {
    return (
      <input
        ref={ref}
        {...props}
        style={{
          padding: size === "sm" ? "3px 8px" : "5px 10px",
          border: "1px solid var(--border)",
          borderRadius: "var(--radius-md)",
          background: "var(--input-bg, #f5f5f5)",
          color: "var(--text)",
          fontSize: 12,
          fontFamily: "'JetBrains Mono', Consolas, monospace",
          outline: "none",
          ...style,
        }}
        className={cn(className)}
      />
    );
  }
);
Input.displayName = "Input";

interface SelectProps extends Omit<React.SelectHTMLAttributes<HTMLSelectElement>, "size"> {
  size?: "sm" | "md";
}

export const Select = React.forwardRef<HTMLSelectElement, SelectProps>(
  ({ size = "md", className, style, children, ...props }, ref) => {
    return (
      <select
        ref={ref}
        {...props}
        style={{
          padding: size === "sm" ? "3px 8px" : "5px 10px",
          border: "1px solid var(--border)",
          borderRadius: "var(--radius-md)",
          background: "#f5f5f5",
          color: "var(--text)",
          fontSize: 12,
          fontFamily: "'Inter', 'Segoe UI', system-ui, sans-serif",
          outline: "none",
          cursor: "pointer",
          ...style,
        }}
        className={cn(className)}
      >
        {children}
      </select>
    );
  }
);
Select.displayName = "Select";
