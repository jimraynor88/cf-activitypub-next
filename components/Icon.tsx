"use client";

export type IconName = string;

interface IconProps {
  name: IconName;
  size?: string | number;
  color?: string;
  className?: string;
  style?: React.CSSProperties;
  title?: string;
  spin?: boolean;
  fixedWidth?: boolean;
}

/**
 * Fork Awesome icon in the brand color. Override with `color` when the
 * surrounding button already carries a background (white on accent/danger) or
 * the context demands a different tone.
 */
export function Icon({ name, size, color, className, style, title, spin, fixedWidth }: IconProps) {
  return (
    <i
      className={`fa fa-${name}${spin ? " fa-spin" : ""}${fixedWidth ? " fa-fw" : ""}${className ? ` ${className}` : ""}`}
      aria-hidden={title ? undefined : "true"}
      title={title}
      style={{
        color: color ?? "var(--accent)",
        ...(size !== undefined ? { fontSize: typeof size === "number" ? size : size } : {}),
        ...style,
      }}
    />
  );
}