"use client";

import { useState, useRef } from "react";
import { useRouter } from "next/navigation";
import { Sidebar } from "@/components/Sidebar";
import { PageLayout } from "@/components/PageLayout";
import { SettingsHeader } from "@/components/SettingsHeader";
import { useLocale } from "@/lib/i18n";
import { getToken } from "@/lib/client-api";

interface ImportResult {
  acct: string;
  status: "followed" | "already_following" | "not_found" | "error";
  error?: string;
}

export default function ImportExportPage() {
  const router = useRouter();
  const token = getToken();
  const { t } = useLocale();
  const fileRef = useRef<HTMLInputElement>(null);
  const [importing, setImporting] = useState(false);
  const [exporting, setExporting] = useState(false);
  const [results, setResults] = useState<ImportResult[] | null>(null);
  const [counts, setCounts] = useState<Record<string, number> | null>(null);
  const [error, setError] = useState<string | null>(null);

  if (!token) {
    router.push("/login");
  }

  async function handleExport() {
    if (!token) return;
    setExporting(true);
    try {
      const res = await fetch("/api/v1/export/follows", {
        headers: { Authorization: `Bearer ${token}` },
      });
      if (!res.ok) { setError("Export failed"); return; }
      const csv = await res.text();
      const blob = new Blob([csv], { type: "text/csv" });
      const url = URL.createObjectURL(blob);
      const a = document.createElement("a");
      a.href = url;
      a.download = "following.csv";
      a.click();
      URL.revokeObjectURL(url);
    } catch {
      setError("Export failed");
    }
    setExporting(false);
  }

  async function handleImport(e: React.ChangeEvent<HTMLInputElement>) {
    const file = e.target.files?.[0];
    if (!file || !token) return;
    setImporting(true);
    setResults(null);
    setCounts(null);
    setError(null);
    try {
      const text = await file.text();
      const res = await fetch("/api/v1/import/follows", {
        method: "POST",
        headers: { Authorization: `Bearer ${token}`, "Content-Type": "text/csv" },
        body: text,
      });
      const data = await res.json() as { results: ImportResult[]; counts: Record<string, number>; total: number; error?: string };
      if (!res.ok) {
        setError(data.error ?? "Import failed");
      } else {
        setResults(data.results);
        setCounts(data.counts);
      }
    } catch {
      setError("Import failed");
    }
    setImporting(false);
    if (fileRef.current) fileRef.current.value = "";
  }

  return (
    <PageLayout sidebar={<Sidebar me={null} currentPath="/settings/import-export" />}>
      <SettingsHeader />

      <div style={{ padding: "1rem", display: "flex", flexDirection: "column", gap: "1.5rem", maxWidth: 560 }}>
        <div>
          <h2 style={{ fontWeight: 600, fontSize: "0.95rem", marginBottom: "0.25rem" }}>Following list export</h2>
          <p style={{ fontSize: "0.85rem", color: "var(--text-muted)", marginBottom: "0.75rem" }}>
            Download the accounts you follow as a CSV file, usable as a backup or to move to another instance.
          </p>
          <button className="btn btn-outline btn-sm" onClick={() => void handleExport()} disabled={exporting}>
            {exporting ? "…" : "⬇ Export following list"}
          </button>
        </div>

        <div>
          <h2 style={{ fontWeight: 600, fontSize: "0.95rem", marginBottom: "0.25rem" }}>Following list import</h2>
          <p style={{ fontSize: "0.85rem", color: "var(--text-muted)", marginBottom: "0.75rem" }}>
            Restore a backup or import a list from another instance. The CSV must have an{" "}
            <code>Account address</code> column (e.g. <code>user@example.com</code>), one per line.
          </p>
          <input
            ref={fileRef}
            type="file"
            accept=".csv,text/csv"
            disabled={importing}
            onChange={(e) => void handleImport(e)}
            style={{ fontSize: "0.85rem" }}
          />
          {importing && <div style={{ fontSize: "0.85rem", color: "var(--text-muted)", marginTop: "0.5rem" }}>{t.loading}</div>}
          {error && <div style={{ fontSize: "0.85rem", color: "var(--danger)", marginTop: "0.5rem" }}>{error}</div>}
          {counts && (
            <div style={{ fontSize: "0.85rem", marginTop: "0.5rem" }}>
              Followed: {counts.followed ?? 0} · Already following: {counts.already_following ?? 0} ·
              Not found: {counts.not_found ?? 0} · Errors: {counts.error ?? 0}
            </div>
          )}
          {results && results.length > 0 && (
            <div style={{ marginTop: "0.75rem", maxHeight: 220, overflowY: "auto", border: "1px solid var(--border)", borderRadius: "var(--radius)" }}>
              {results.map((r, i) => (
                <div key={i} style={{ display: "flex", gap: "0.5rem", padding: "0.4rem 0.75rem", borderBottom: "1px solid var(--border)", fontSize: "0.8rem" }}>
                  <span style={{ fontWeight: 600, minWidth: 120 }}>{r.acct}</span>
                  <span style={{ color: r.status === "followed" ? "var(--success)" : r.status === "error" || r.status === "not_found" ? "var(--danger)" : "var(--text-muted)" }}>
                    {r.status}
                  </span>
                  {r.error && <span style={{ color: "var(--text-muted)" }}>— {r.error}</span>}
                </div>
              ))}
            </div>
          )}
        </div>
      </div>
    </PageLayout>
  );
}