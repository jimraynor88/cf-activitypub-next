"use client";

import { useState, useEffect } from "react";
import { useRouter } from "next/navigation";
import { Sidebar } from "@/components/Sidebar";
import { PageLayout } from "@/components/PageLayout";
import { SettingsHeader } from "@/components/SettingsHeader";
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
          message: `Moved to ${data.moved_to}. ${data.migrated_followers ?? 0} local followers migrated, Move delivered to ${data.delivered_to ?? 0} remote servers.`,
        });
      } else {
        setResult({ ok: false, message: data.error ?? "Migration failed" });
      }
    } catch {
      setResult({ ok: false, message: "Migration failed" });
    }
    setMigrating(false);
  }

  return (
    <PageLayout sidebar={<Sidebar me={me} currentPath="/settings/migration" />}>
      <SettingsHeader />

      <div style={{ padding: "1rem", display: "flex", flexDirection: "column", gap: "1.25rem", maxWidth: 560 }}>
        {me?.moved ? (
          <div style={{ background: "rgba(251,191,36,0.12)", color: "var(--warning)", padding: "0.75rem 1rem", borderRadius: "var(--radius)", fontSize: "0.875rem" }}>
            This account has moved to <strong>@{me.moved.acct}</strong>.
          </div>
        ) : (
          <>
            <p style={{ fontSize: "0.875rem", color: "var(--text-muted)", lineHeight: 1.5 }}>
              Move this account to another instance. Your followers will be migrated automatically and your profile
              will point to the new account. The target account must list this account as an alias
              (<code>alsoKnownAs</code>) — set that up on the new instance first.
            </p>
            <div>
              <label style={{ display: "block", fontWeight: 600, fontSize: "0.875rem", marginBottom: "0.375rem" }}>Target account</label>
              <input
                className="input"
                placeholder="user@example.com"
                value={targetAcct}
                onChange={(e) => setTargetAcct(e.target.value)}
                style={{ width: "100%" }}
              />
            </div>
            <button className="btn btn-primary btn-sm" style={{ alignSelf: "flex-start" }} onClick={() => void handleMigrate()} disabled={migrating || !targetAcct}>
              {migrating ? "…" : "Move account"}
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