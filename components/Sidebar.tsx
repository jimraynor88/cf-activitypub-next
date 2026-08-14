"use client";

import { useState, useEffect, useSyncExternalStore } from "react";
import { createPortal } from "react-dom";
import Link from "next/link";
import Image from "next/image";
import { getToken } from "@/lib/client-api";
import { useLocale } from "@/lib/i18n";
import { useTimelineStream } from "@/lib/streaming/use-timeline-stream";

interface SidebarAccount {
  username: string;
  display_name: string;
  acct: string;
}

interface SidebarProps {
  me?: SidebarAccount | null;
  currentPath: string;
}

export function Sidebar({ me: propMe, currentPath }: SidebarProps) {
  const { t, locale, setLocale } = useLocale();
  const [unreadCount, setUnreadCount] = useState(0);
  const [localMe, setLocalMe] = useState<SidebarAccount | null | undefined>(propMe);
  const me = propMe ?? localMe;
  const [menuOpen, setMenuOpen] = useState(false);
  // Client-only flag so the mobile top bar (rendered via portal) never runs on
  // the server, avoiding a hydration mismatch. False during SSR, true on client.
  const mounted = useSyncExternalStore(
    () => () => {},
    () => true,
    () => false
  );

  // Start with "light" to match SSR; effect corrects from localStorage without hydration mismatch
  const [theme, setTheme] = useState<"light" | "dark">("light");

  useEffect(() => {
    Promise.resolve().then(() => {
      const saved = localStorage.getItem("theme") as "light" | "dark" | null;
      const resolved: "light" | "dark" =
        saved === "light" || saved === "dark"
          ? saved
          : window.matchMedia("(prefers-color-scheme: dark)").matches
          ? "dark"
          : "light";
      setTheme(resolved);
      document.documentElement.setAttribute("data-theme", resolved);
    });
  }, []);

  function toggleTheme() {
    const next = theme === "dark" ? "light" : "dark";
    setTheme(next);
    localStorage.setItem("theme", next);
    document.documentElement.setAttribute("data-theme", next);
  }

  // One-time fetch for existing unread count on mount
  useEffect(() => {
    fetch("/api/v1/notifications/unread_count", { credentials: "include" }).then(async (res) => {
      if (res.ok) {
        const data = await res.json() as { count: number };
        setUnreadCount(data.count);
      }
    }).catch(() => {});
  }, []);

  // Self-fetch current user info when page doesn't pass `me` prop
  useEffect(() => {
    if (propMe !== undefined) return;
    Promise.resolve().then(() => {
      const token = getToken();
      if (!token) { setLocalMe(null); return; }
      fetch("/api/v1/accounts/verify_credentials", {
        headers: { Authorization: `Bearer ${token}` },
      }).then(async (res) => {
        if (res.ok) {
          const data = await res.json() as SidebarAccount;
          setLocalMe(data);
        } else {
          setLocalMe(null);
        }
      }).catch(() => setLocalMe(null));
    });
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // Real-time notification count via WebSocket streaming (no polling)
  useTimelineStream("user", (event) => {
    if (event === "notification") {
      setUnreadCount((c) => c + 1);
    }
  });

  async function handleLogout() {
    await fetch("/api/auth/logout", { method: "POST", credentials: "include" });
    window.location.href = "/login";
  }

  const navItems = [
    { label: t.nav_home, icon: "🏠", href: "/home", badge: 0 },
    { label: t.nav_explore, icon: "🔍", href: "/explore", badge: 0 },
    { label: t.nav_timelines, icon: "🌐", href: "/timelines", badge: 0 },
    { label: t.nav_notifications, icon: "🔔", href: "/notifications", badge: unreadCount, onClick: () => setUnreadCount(0) },
    { label: t.nav_messages, icon: "💬", href: "/messages", badge: 0 },
    { label: t.nav_e2ee, icon: "🔒", href: "/e2ee", badge: 0 },
    { label: t.nav_bookmarks, icon: "🔖", href: "/bookmarks", badge: 0 },
    { label: t.nav_favourites, icon: "❤️", href: "/favourites", badge: 0 },
    { label: t.nav_lists, icon: "📋", href: "/lists", badge: 0 },
    { label: t.nav_followed_tags, icon: "🏷️", href: "/followed_tags", badge: 0 },
    { label: t.nav_mutes, icon: "🤫", href: "/mutes", badge: 0 },
    { label: t.nav_scheduled, icon: "📅", href: "/scheduled", badge: 0 },
    { label: t.nav_profile, icon: "👤", href: me ? `/users/${me.username}` : "/login", badge: 0 },
    { label: t.nav_settings, icon: "⚙️", href: "/settings", badge: 0 },
    { label: t.nav_blocks, icon: "🚫", href: "/blocks", badge: 0 },
    { label: t.nav_emojis, icon: "😊", href: "/emojis", badge: 0 },
    { label: t.nav_announcements, icon: "📢", href: "/announcements", badge: 0 },
  ];

  return (
    <>
    <aside
      style={{
        width: 260,
        flexShrink: 0,
        padding: "1.5rem 1rem",
        borderRight: "1px solid var(--border)",
        flexDirection: "column",
        gap: "1.5rem",
        overflowX: "hidden",
      }}
      className="hidden md:flex"
    >
      {/* Logo */}
      <Link href="/" className="flex items-center gap-2 px-2">
        <Image src="/logo.svg" alt="CF ActivityPub" width={32} height={32} />
        <span style={{ fontWeight: 700, fontSize: "1.1rem" }}>CF ActivityPub</span>
      </Link>

      {/* Nav */}
      <nav className="flex flex-col gap-1">
        {navItems.map((item) => (
          <Link
            key={item.href}
            href={item.href}
            onClick={item.onClick}
            className="btn btn-ghost"
            style={{
              justifyContent: "flex-start",
              gap: "0.75rem",
              padding: "0.625rem 0.875rem",
              background: currentPath === item.href ? "var(--accent-bg)" : undefined,
            }}
          >
            <span style={{ position: "relative", display: "inline-flex" }}>
              {item.icon}
              {item.badge > 0 && (
                <span
                  style={{
                    position: "absolute",
                    top: -5,
                    right: -8,
                    background: "var(--danger, #e11d48)",
                    color: "white",
                    borderRadius: "99px",
                    fontSize: "0.6rem",
                    fontWeight: 700,
                    padding: "0.1rem 0.28rem",
                    minWidth: 14,
                    lineHeight: "1.4",
                    textAlign: "center",
                    pointerEvents: "none",
                  }}
                >
                  {item.badge > 99 ? "99+" : item.badge}
                </span>
              )}
            </span>
            <span>{item.label}</span>
          </Link>
        ))}
      </nav>

      {/* Bottom: language toggle + user info + logout */}
      <div style={{ marginTop: "auto", display: "flex", flexDirection: "column", gap: "0.5rem" }}>
        <button
          onClick={toggleTheme}
          className="btn btn-ghost btn-sm"
          style={{ width: "100%", justifyContent: "flex-start", gap: "0.75rem" }}
          title={theme === "dark" ? t.theme_dark : t.theme_light}
        >
          <span>{theme === "dark" ? "🌙" : "☀️"}</span>
          <span>{theme === "dark" ? t.theme_dark : t.theme_light}</span>
        </button>

        {/* Language toggle */}
        <div style={{ display: "flex", gap: "0.375rem" }}>
          <button
            onClick={() => setLocale("en")}
            className="btn btn-ghost btn-sm"
            style={{
              flex: 1,
              fontWeight: locale === "en" ? 700 : 400,
              background: locale === "en" ? "var(--accent-bg)" : undefined,
              color: locale === "en" ? "var(--accent)" : "var(--text-muted)",
            }}
          >
            EN
          </button>
          <button
            onClick={() => setLocale("es")}
            className="btn btn-ghost btn-sm"
            style={{
              flex: 1,
              fontWeight: locale === "es" ? 700 : 400,
              background: locale === "es" ? "var(--accent-bg)" : undefined,
              color: locale === "es" ? "var(--accent)" : "var(--text-muted)",
            }}
          >
            ES
          </button>
        </div>

        {/* User info + logout */}
        {me ? (
          <div
            style={{
              display: "flex",
              alignItems: "center",
              gap: "0.625rem",
              padding: "0.625rem 0.75rem",
              borderRadius: "var(--radius)",
              background: "var(--bg-elevated)",
            }}
          >
            <div
              className="avatar"
              style={{
                width: 34,
                height: 34,
                flexShrink: 0,
                background: "var(--accent-bg)",
                display: "flex",
                alignItems: "center",
                justifyContent: "center",
                fontSize: "1.1rem",
              }}
            >
              {(me.display_name?.[0] ?? me.username?.[0] ?? "?").toUpperCase()}
            </div>
            <div style={{ flex: 1, minWidth: 0 }}>
              <div style={{ fontWeight: 600, fontSize: "0.85rem", overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>
                {me.display_name || me.username}
              </div>
              <div style={{ fontSize: "0.75rem", color: "var(--text-muted)" }}>@{me.acct}</div>
            </div>
            <button
              onClick={handleLogout}
              className="btn btn-ghost btn-sm"
              style={{ flexShrink: 0, padding: "0.3rem 0.45rem", fontSize: "1rem", lineHeight: 1 }}
              title={t.nav_logout}
            >
              🚪
            </button>
          </div>
        ) : (
          <button
            onClick={handleLogout}
            className="btn btn-ghost btn-sm"
            style={{ width: "100%", justifyContent: "center", color: "var(--text-muted)" }}
          >
            🚪 {t.nav_logout}
          </button>
        )}
      </div>
    </aside>

    {/* Mobile top bar + menu — rendered via portal so it is NOT inside the
        `.page-sidebar` container, which `globals.css` hides on mobile. */}
    {mounted &&
      createPortal(
        <div className="md:hidden">
          {/* Fixed top bar */}
          <div
            style={{
              position: "fixed",
              top: 0,
              left: 0,
              right: 0,
              zIndex: 50,
              height: 56,
              display: "flex",
              alignItems: "center",
              gap: "0.5rem",
              padding: "0 0.75rem",
              background: "var(--bg-surface)",
              borderBottom: "1px solid var(--border)",
            }}
          >
            <button
              onClick={() => setMenuOpen((v) => !v)}
              aria-label="Menu"
              style={{
                background: "none",
                border: "none",
                cursor: "pointer",
                fontSize: "1.4rem",
                lineHeight: 1,
                color: "var(--text)",
                padding: "0.35rem 0.5rem",
                borderRadius: "var(--radius)",
              }}
            >
              {menuOpen ? "✕" : "☰"}
            </button>
            <Link href="/" style={{ display: "flex", alignItems: "center", gap: "0.5rem", fontWeight: 700, color: "var(--text)", textDecoration: "none" }}>
              <Image src="/logo.svg" alt="CF ActivityPub" width={26} height={26} />
              <span style={{ fontSize: "1rem" }}>CF ActivityPub</span>
            </Link>
            <button
              onClick={toggleTheme}
              style={{ marginLeft: "auto", background: "none", border: "none", cursor: "pointer", fontSize: "1.3rem", lineHeight: 1, color: "var(--text-muted)" }}
              title={theme === "dark" ? t.theme_dark : t.theme_light}
            >
              {theme === "dark" ? "🌙" : "☀️"}
            </button>
          </div>

          {/* Slide-down drawer */}
          {menuOpen && (
            <div
              style={{
                position: "fixed",
                top: 56,
                left: 0,
                right: 0,
                bottom: 0,
                zIndex: 49,
                background: "var(--bg-surface)",
                overflowY: "auto",
                padding: "0.5rem 0.75rem 1.5rem",
              }}
            >
              <nav style={{ display: "flex", flexDirection: "column", gap: "0.25rem" }}>
                {navItems.map((item) => (
                  <Link
                    key={item.href}
                    href={item.href}
                    onClick={() => { setMenuOpen(false); item.onClick?.(); }}
                    style={{
                      display: "flex",
                      alignItems: "center",
                      gap: "0.75rem",
                      padding: "0.7rem 0.875rem",
                      borderRadius: "var(--radius)",
                      color: currentPath === item.href ? "var(--accent)" : "var(--text)",
                      background: currentPath === item.href ? "var(--accent-bg)" : undefined,
                      textDecoration: "none",
                      fontWeight: currentPath === item.href ? 700 : 400,
                      position: "relative",
                    }}
                  >
                    <span style={{ position: "relative", display: "inline-flex" }}>
                      {item.icon}
                      {item.badge > 0 && (
                        <span
                          style={{
                            position: "absolute",
                            top: -5,
                            right: -8,
                            background: "var(--danger, #e11d48)",
                            color: "white",
                            borderRadius: "99px",
                            fontSize: "0.6rem",
                            fontWeight: 700,
                            padding: "0.1rem 0.28rem",
                            minWidth: 14,
                            lineHeight: "1.4",
                            textAlign: "center",
                            pointerEvents: "none",
                          }}
                        >
                          {item.badge > 99 ? "99+" : item.badge}
                        </span>
                      )}
                    </span>
                    <span>{item.label}</span>
                  </Link>
                ))}
              </nav>

              {/* Language toggle */}
              <div style={{ display: "flex", gap: "0.375rem", marginTop: "0.75rem", padding: "0 0.5rem" }}>
                <button
                  onClick={() => setLocale("en")}
                  className="btn btn-ghost btn-sm"
                  style={{
                    flex: 1,
                    fontWeight: locale === "en" ? 700 : 400,
                    background: locale === "en" ? "var(--accent-bg)" : undefined,
                    color: locale === "en" ? "var(--accent)" : "var(--text-muted)",
                  }}
                >
                  EN
                </button>
                <button
                  onClick={() => setLocale("es")}
                  className="btn btn-ghost btn-sm"
                  style={{
                    flex: 1,
                    fontWeight: locale === "es" ? 700 : 400,
                    background: locale === "es" ? "var(--accent-bg)" : undefined,
                    color: locale === "es" ? "var(--accent)" : "var(--text-muted)",
                  }}
                >
                  ES
                </button>
              </div>

              {/* User info + logout */}
              <div style={{ padding: "0.5rem", marginTop: "0.25rem" }}>
                {me ? (
                  <div
                    style={{
                      display: "flex",
                      alignItems: "center",
                      gap: "0.625rem",
                      padding: "0.625rem 0.75rem",
                      borderRadius: "var(--radius)",
                      background: "var(--bg-elevated)",
                    }}
                  >
                    <div
                      className="avatar"
                      style={{
                        width: 34,
                        height: 34,
                        flexShrink: 0,
                        background: "var(--accent-bg)",
                        display: "flex",
                        alignItems: "center",
                        justifyContent: "center",
                        fontSize: "1.1rem",
                      }}
                    >
                      {(me.display_name?.[0] ?? me.username?.[0] ?? "?").toUpperCase()}
                    </div>
                    <div style={{ flex: 1, minWidth: 0 }}>
                      <div style={{ fontWeight: 600, fontSize: "0.85rem", overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>
                        {me.display_name || me.username}
                      </div>
                      <div style={{ fontSize: "0.75rem", color: "var(--text-muted)" }}>@{me.acct}</div>
                    </div>
                    <button
                      onClick={handleLogout}
                      className="btn btn-ghost btn-sm"
                      style={{ flexShrink: 0, padding: "0.3rem 0.45rem", fontSize: "1rem", lineHeight: 1 }}
                      title={t.nav_logout}
                    >
                      🚪
                    </button>
                  </div>
                ) : (
                  <button
                    onClick={handleLogout}
                    className="btn btn-ghost btn-sm"
                    style={{ width: "100%", justifyContent: "center", color: "var(--text-muted)" }}
                  >
                    🚪 {t.nav_logout}
                  </button>
                )}
              </div>
            </div>
          )}
        </div>,
        document.body
      )}
    </>
  );
}
