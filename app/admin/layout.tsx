"use client";

import { useState, useEffect } from "react";
import { useRouter, usePathname } from "next/navigation";
import Link from "next/link";
import { getToken } from "@/lib/client-api";
import { useLocale, type Translations } from "@/lib/i18n";

const navItems: { key: keyof Translations; href: string }[] = [
  { key: "admin_dashboard", href: "/admin" },
  { key: "admin_accounts", href: "/admin/accounts" },
  { key: "admin_suspended", href: "/admin/suspended" },
  { key: "admin_blocked", href: "/admin/blocked" },
  { key: "admin_reports", href: "/admin/reports" },
  { key: "admin_moderation_log", href: "/admin/moderation_log" },
];

export default function AdminLayout({ children }: { children: React.ReactNode }) {
  const router = useRouter();
  const pathname = usePathname();
  const { t } = useLocale();
  const [authorized, setAuthorized] = useState(false);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    const token = getToken();
    if (!token) {
      router.push("/login");
      return;
    }

    fetch("/api/v1/accounts/verify_credentials", {
      headers: { Authorization: `Bearer ${token}` },
    })
      .then((r) => r.json() as Promise<{ id: string; username: string; roles: { name: string }[] }>)
      .then((me) => {
        const roleName = me.roles?.[0]?.name?.toLowerCase() ?? "user";
        if (roleName === "admin" || roleName === "moderator") {
          setAuthorized(true);
        } else {
          router.push("/home");
        }
      })
      .catch(() => router.push("/login"))
      .finally(() => setLoading(false));
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  if (loading) {
    return (
      <div style={{ display: "flex", minHeight: "100vh", alignItems: "center", justifyContent: "center", background: "var(--bg)" }}>
        <div style={{ color: "var(--text-muted)" }}>{t.loading}</div>
      </div>
    );
  }

  if (!authorized) return null;

  return (
    <div className="admin-layout">
      <aside className="admin-sidebar">
        <div className="admin-sidebar-title">
          <Link href="/admin">Admin</Link>
        </div>
        {navItems.map((item) => {
          const active = pathname === item.href || (item.href !== "/admin" && pathname.startsWith(item.href));
          return (
            <Link
              key={item.href}
              href={item.href}
              className={`admin-nav-item${active ? " active" : ""}`}
            >
              {t[item.key]}
            </Link>
          );
        })}
        <div className="admin-nav-back">
          <Link href="/home">← {t.admin_back_to_app}</Link>
        </div>
      </aside>
      <main className="admin-main">{children}</main>
    </div>
  );
}
