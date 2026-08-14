"use client";

import { useState, useEffect } from "react";
import { useRouter } from "next/navigation";
import { Sidebar } from "@/components/Sidebar";
import { PageLayout } from "@/components/PageLayout";
import { SettingsHeader } from "@/components/SettingsHeader";
import { useLocale } from "@/lib/i18n";
import { getToken } from "@/lib/client-api";

interface Me {
  id: string;
  username: string;
  acct: string;
  display_name: string;
  avatar: string;
  moved?: { acct: string } | null;
}

export default function MigrationPage() {
  const router = useRouter();
  const token = getToken();
  const { t } = useLocale();
  const [me, setMe] = useState<Me | null>(null);
  const [targetAcct, setTargetAcct] = useState("");
  const [migrating, setMigrating] = useState(false);
  const [result, setResult] = useState<{ ok: boolean; message: string } | null>(null);

  useEffect(() => {
    if (!token) { router.push("/login"); return; }
    async function fetchMe() {
      const res = await fetch("/api/v1/accounts/verify_credentials", {
        headers: { Authorization: `Bearer ${token}` },
      });
      if (res.ok) setMe(await res.json() as Me);
    }
    void fetchMe();
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  async function handleMigrate() {
    if (!token) return;
    setMigrating(true);
    setResult(null);
    try {
      const res = await fetch("/api/v1/accounts/migrate", {
        method: "POST",
        headers: { Authorization: `Bearer ${token}`, "Content-Type": "application/json" },
        body: JSON.stringify({ target_acct: targetAcct }),
      });
      const data = await res.json() as { error?: string; moved_to?: string; migrated_followers?: number; delivered_to?: number };
      if (res.ok) {
        setResult({
          ok: true,
          message: t.settings_migration_result
            .replace("{moved}", data.moved_to ?? "")
            .replace("{followers}", String(data.migrated_followers ?? 0))
            .replace("{servers}", String(data.delivered_to ?? 0)),
        });
      } else {
        setResult({ ok: false, message: data.error ?? t.settings_migration_failed });
      }
    } catch {
      setResult({ ok: false, message: t.settings_migration_failed });
    }
    setMigrating(false);
  }

  return (
    <PageLayout sidebar={<Sidebar me={me} currentPath="/settings/migration" />}>
      <SettingsHeader />

      <div style={{ padding: "1rem", display: "flex", flexDirection: "column", gap: "1.25rem", maxWidth: 560 }}>
        {me?.moved ? (
          <div style={{ background: "rgba(251,191,36,0.12)", color: "var(--warning)", padding: "0.75rem 1rem", borderRadius: "var(--radius)", fontSize: "0.875rem" }}>
            {t.settings_migration_moved} <strong>@{me.moved.acct}</strong>.
          </div>
        ) : (
          <>
            <p style={{ fontSize: "0.875rem", color: "var(--text-muted)", lineHeight: 1.5 }}>
              {t.settings_migration_desc}
            </p>
            <div>
              <label style={{ display: "block", fontWeight: 600, fontSize: "0.875rem", marginBottom: "0.375rem" }}>{t.settings_migration_target}</label>
              <input
                className="input"
                placeholder="user@example.com"
                value={targetAcct}
                onChange={(e) => setTargetAcct(e.target.value)}
                style={{ width: "100%" }}
              />
            </div>
            <button className="btn btn-primary btn-sm" style={{ alignSelf: "flex-start" }} onClick={() => void handleMigrate()} disabled={migrating || !targetAcct}>
              {migrating ? "…" : t.settings_migration_button}
            </button>
            {result && (
              <div style={{ fontSize: "0.875rem", color: result.ok ? "var(--success)" : "var(--danger)", background: result.ok ? "rgba(52,211,153,0.1)" : "rgba(248,113,113,0.1)", padding: "0.75rem 1rem", borderRadius: "var(--radius)" }}>
                {result.message}
              </div>
            )}
          </>
        )}
      </div>
    </PageLayout>
  );
}