"use client";

import { useEffect, useState } from "react";
import Link from "next/link";
import Image from "next/image";
import { useLocale } from "@/lib/i18n";
import { PageLayout } from "@/components/PageLayout";
import { Sidebar } from "@/components/Sidebar";

// /e2ee — vista del usuario autenticado sobre sus mensajes MLS y key packages.
// Solo se muestran metadatos y envoltorios de cifrado: este servidor nunca
// descifra el contenido de los mensajes.

interface Sender {
  id: string;
  username: string;
  acct: string;
  displayName: string;
  avatarUrl: string | null;
}

interface MlsMessage {
  id: string;
  recipientId: string;
  type: string;
  objectType: string | null;
  sender: Sender;
  conversation: string | null;
  content: string | null;
  published: string;
}

interface KeyPackage {
  id: string;
  objectId: string;
  ciphersuite: string | null;
  encoding: string | null;
  content: string | null;
  isActive: boolean;
  createdAt: string;
}

interface E2eeData {
  me: { id: string; username: string; acct: string; acctFull: string } & Sender;
  keyPackagesUrl: string;
  messagesUrl: string;
  messages: MlsMessage[];
  keyPackages: KeyPackage[];
  conversations: { conversation: string; last: string }[];
}

function formatRelativeTime(iso: string): string {
  const diff = Date.now() - new Date(iso).getTime();
  const sec = Math.floor(diff / 1000);
  if (sec < 60) return `${sec}s`;
  if (sec < 3600) return `${Math.floor(sec / 60)}m`;
  if (sec < 86400) return `${Math.floor(sec / 3600)}h`;
  const d = new Date(iso);
  return `${d.getDate().toString().padStart(2, "0")}/${(d.getMonth() + 1).toString().padStart(2, "0")}/${d.getFullYear()}`;
}

function envelopePreview(content: string | null, emptyLabel: string): string {
  if (!content) return emptyLabel;
  const flat = content.replace(/\s+/g, "");
  const head = flat.slice(0, 72);
  return flat.length > head.length ? `${head}…` : head;
}

function Avatar({ sender, size = 40 }: { sender: Sender; size?: number }) {
  const initial = (sender.displayName?.[0] ?? sender.username?.[0] ?? "?").toUpperCase();
  if (sender.avatarUrl) {
    return (
      <Image
        src={sender.avatarUrl}
        alt={sender.displayName}
        width={size}
        height={size}
        style={{ borderRadius: "50%", objectFit: "cover", flexShrink: 0 }}
      />
    );
  }
  return (
    <div
      style={{
        width: size,
        height: size,
        flexShrink: 0,
        borderRadius: "50%",
        background: "var(--accent-bg)",
        display: "flex",
        alignItems: "center",
        justifyContent: "center",
        fontSize: size * 0.45,
        fontWeight: 700,
        color: "var(--accent)",
      }}
    >
      {initial}
    </div>
  );
}

function EnvelopePreview({ text }: { text: string }) {
  return (
    <div
      style={{
        marginTop: "0.5rem",
        background: "var(--bg-elevated)",
        border: "1px solid var(--border)",
        borderRadius: "var(--radius-sm)",
        padding: "0.5rem 0.625rem",
        fontFamily: "ui-monospace, SFMono-Regular, Menlo, monospace",
        fontSize: "0.75rem",
        color: "var(--text-muted)",
        overflowX: "auto",
        whiteSpace: "nowrap",
      }}
    >
      {text}
    </div>
  );
}

function messageTitle(t: ReturnType<typeof useLocale>["t"], m: MlsMessage): string {
  switch (m.objectType) {
    case "Welcome": return t.e2ee_msg_welcome;
    case "GroupInfo": return t.e2ee_msg_groupinfo;
    case "PrivateMessage": return t.e2ee_msg_private;
    case "PublicMessage": return t.e2ee_msg_public;
    case "KeyPackage": return t.e2ee_msg_keypackage;
    default: return m.type === "Delete" ? t.e2ee_msg_deleted : (m.objectType ?? t.e2ee_msg_generic);
  }
}

export default function E2EEPage() {
  const { t } = useLocale();
  const [data, setData] = useState<E2eeData | null>(null);
  const [authed, setAuthed] = useState<boolean | null>(null);

  useEffect(() => {
    fetch("/api/v1/e2ee", { credentials: "include" })
      .then(async (res) => {
        if (res.status === 401) { setAuthed(false); return; }
        if (!res.ok) { setAuthed(false); return; }
        setData(await res.json() as E2eeData);
        setAuthed(true);
      })
      .catch(() => setAuthed(false));
  }, []);

  if (authed === null) {
    return (
      <PageLayout sidebar={<Sidebar me={null} currentPath="/e2ee" />}>
        <LoadingSkeleton />
      </PageLayout>
    );
  }

  if (!authed || !data) {
    return (
      <PageLayout sidebar={<Sidebar me={null} currentPath="/e2ee" />}>
        <div className="flex flex-col items-center justify-center" style={{ padding: "5rem 2rem", textAlign: "center", color: "var(--text-muted)" }}>
          <span style={{ fontSize: "3rem", marginBottom: "1rem" }}>🔒</span>
          <h2 style={{ margin: 0 }}>{t.e2ee_signed_out_title}</h2>
          <p style={{ maxWidth: 420, fontSize: "0.9rem" }}>{t.e2ee_signed_out_body}</p>
          <Link href="/login" className="btn btn-primary">{t.e2ee_sign_in}</Link>
        </div>
      </PageLayout>
    );
  }

  const conversationsPreview = data.conversations.map((c) => c.conversation).join(" · ");

  return (
    <PageLayout sidebar={<Sidebar me={{ username: data.me.username, display_name: data.me.displayName, acct: data.me.acct }} currentPath="/e2ee" />}>
      {/* Cabecera */}
      <div style={{ padding: "1.25rem 1rem", borderBottom: "1px solid var(--border)", background: "var(--bg-surface)" }}>
        <div style={{ display: "flex", alignItems: "flex-start", justifyContent: "space-between", gap: "1rem", flexWrap: "wrap" }}>
          <div style={{ minWidth: 0 }}>
            <h1 style={{ fontSize: "1.35rem", margin: 0, display: "flex", alignItems: "center", gap: "0.5rem", flexWrap: "wrap" }}>
              🔒 {t.e2ee_title}
              <span className="badge badge-accent">{t.e2ee_badge_mls}</span>
            </h1>
            <p style={{ margin: "0.25rem 0 0", color: "var(--text-muted)", fontSize: "0.85rem" }}>
              {t.e2ee_account_line}{" "}
              <strong style={{ color: "var(--text-primary)" }}>@{data.me.acctFull}</strong>
            </p>
          </div>
          <div style={{ display: "flex", gap: "0.75rem", flexWrap: "wrap" }}>
            <Stat value={data.messages.length} label={t.e2ee_stat_messages} />
            <Stat value={data.keyPackages.length} label={t.e2ee_stat_key_packages} />
            <Stat value={data.conversations.length} label={t.e2ee_stat_conversations} />
          </div>
        </div>

        <div style={{ marginTop: "0.75rem", display: "flex", gap: "0.5rem", flexWrap: "wrap", fontSize: "0.82rem", color: "var(--text-muted)" }}>
          <span>{t.e2ee_stats_hint}</span>
          <Link href={data.keyPackagesUrl} style={{ wordBreak: "break-all" }}>keyPackages</Link>
          <span>·</span>
          <Link href={data.messagesUrl} style={{ wordBreak: "break-all" }}>messages</Link>
        </div>
      </div>

      {/* Key packages */}
      <section>
        <div style={{ display: "flex", alignItems: "center", gap: "0.5rem", padding: "0.9rem 1rem", borderBottom: "1px solid var(--border)" }}>
          <h2 style={{ margin: 0, fontSize: "0.95rem", fontWeight: 600 }}>
            {t.e2ee_key_packages_title} <span style={{ color: "var(--text-muted)", fontWeight: 400 }}>{t.e2ee_key_packages_sub}</span>
          </h2>
        </div>
        {data.keyPackages.length === 0 ? (
          <EmptyState icon="🗝️" title={t.e2ee_no_key_packages} sub={t.e2ee_no_key_packages_sub} />
        ) : (
          data.keyPackages.map((kp) => (
            <div
              key={kp.id}
              className="status-card"
              style={{ display: "flex", alignItems: "flex-start", gap: "0.75rem", padding: "1rem", flexWrap: "wrap" }}
            >
              <span style={{ fontSize: "1.2rem", lineHeight: 1 }}>🗝️</span>
              <div className="flex-1" style={{ minWidth: 0 }}>
                <div style={{ display: "flex", alignItems: "center", gap: "0.5rem", flexWrap: "wrap" }}>
                  <span
                    className={kp.isActive ? "badge badge-success" : "badge"}
                    style={!kp.isActive ? { background: "var(--bg-elevated)", color: "var(--text-muted)", border: "1px solid var(--border)" } : undefined}
                  >
                    {kp.isActive ? t.e2ee_kp_active : t.e2ee_kp_retired}
                  </span>
                  <span className="badge" style={{ background: "var(--bg-elevated)", border: "1px solid var(--border)", color: "var(--text-secondary)" }}>
                    {kp.ciphersuite ?? "MLS"}
                  </span>
                  <span style={{ marginLeft: "auto", fontSize: "0.78rem", color: "var(--text-muted)" }}>
                    {formatRelativeTime(kp.createdAt)}
                  </span>
                </div>
                <EnvelopePreview text={envelopePreview(kp.content, t.e2ee_envelope_empty)} />
              </div>
            </div>
          ))
        )}
      </section>

      {/* Mensajes */}
      <section>
        <div style={{ display: "flex", alignItems: "center", gap: "0.5rem", padding: "0.9rem 1rem", borderBottom: "1px solid var(--border)" }}>
          <h2 style={{ margin: 0, fontSize: "0.95rem", fontWeight: 600 }}>{t.e2ee_messages_title}</h2>
          {data.conversations.length > 0 && (
            <span style={{ fontSize: "0.78rem", color: "var(--text-muted)", overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap", flex: 1, minWidth: 0 }}>
              · {conversationsPreview}
            </span>
          )}
        </div>
        {data.messages.length === 0 ? (
          <EmptyState icon="💬" title={t.e2ee_no_messages} sub={t.e2ee_no_messages_sub} />
        ) : (
          data.messages.map((m) => (
            <MlsMessageRow key={`${m.recipientId}:${m.id}`} m={m} t={t} />
          ))
        )}
      </section>

      <div style={{ padding: "1rem", fontSize: "0.78rem", color: "var(--text-muted)" }}>
        {t.e2ee_footer}
      </div>
    </PageLayout>
  );
}

function Stat({ value, label }: { value: number; label: string }) {
  return (
    <div className="card" style={{ padding: "0.5rem 0.85rem", textAlign: "center", borderRadius: "var(--radius)" }}>
      <div style={{ fontWeight: 700, fontSize: "1.1rem" }}>{value}</div>
      <div style={{ fontSize: "0.72rem", color: "var(--text-muted)" }}>{label}</div>
    </div>
  );
}

function EmptyState({ icon, title, sub }: { icon: string; title: string; sub: string }) {
  return (
    <div
      className="flex flex-col items-center justify-center"
      style={{ padding: "3.5rem 1.5rem", color: "var(--text-muted)", textAlign: "center" }}
    >
      <span style={{ fontSize: "2.5rem", marginBottom: "0.75rem" }}>{icon}</span>
      <p style={{ margin: 0, fontWeight: 600, color: "var(--text-secondary)" }}>{title}</p>
      <p style={{ margin: "0.25rem 0 0", fontSize: "0.85rem" }}>{sub}</p>
    </div>
  );
}

function LoadingSkeleton() {
  return (
    <div className="flex flex-col gap-0">
      {[1, 2, 3].map((i) => (
        <div key={i} className="status-card flex gap-3" style={{ padding: "1rem" }}>
          <div className="skeleton" style={{ width: 42, height: 42, borderRadius: "50%", flexShrink: 0 }} />
          <div className="flex flex-col gap-2 flex-1">
            <div className="skeleton" style={{ height: 14, width: "40%" }} />
            <div className="skeleton" style={{ height: 14, width: "80%" }} />
            <div className="skeleton" style={{ height: 14, width: "60%" }} />
          </div>
        </div>
      ))}
    </div>
  );
}

function MlsMessageRow({ m, t }: { m: MlsMessage; t: ReturnType<typeof useLocale>["t"] }) {
  return (
    <div className="status-card flex gap-3" style={{ alignItems: "flex-start", padding: "1rem" }}>
      <Avatar sender={m.sender} />
      <div className="flex-1" style={{ minWidth: 0 }}>
        <div style={{ display: "flex", alignItems: "center", gap: "0.5rem", flexWrap: "wrap" }}>
          <span style={{ fontWeight: 600, fontSize: "0.92rem" }}>{m.sender.displayName || m.sender.username}</span>
          <span style={{ fontSize: "0.8rem", color: "var(--text-muted)" }}>@{m.sender.acct}</span>
          <span className="badge badge-accent" style={{ flexShrink: 0 }} title="MLS (Messaging Layer Security)">
            {t.e2ee_badge_encrypted}
          </span>
          <span
            className="badge"
            style={{ background: "var(--bg-elevated)", color: "var(--text-secondary)", border: "1px solid var(--border)" }}
          >
            {m.type}
          </span>
          <span style={{ marginLeft: "auto", fontSize: "0.78rem", color: "var(--text-muted)" }}>
            {formatRelativeTime(m.published)}
          </span>
        </div>

        <div style={{ marginTop: "0.25rem", fontSize: "0.88rem", color: "var(--text-secondary)" }}>
          <span style={{ fontWeight: 600, color: "var(--text-primary)" }}>{messageTitle(t, m)}</span>
          {m.objectType === "Welcome" && (
            <span style={{ marginLeft: "0.5rem", color: "var(--text-muted)", fontSize: "0.82rem" }}>
              {t.e2ee_msg_welcome_hint}
            </span>
          )}
        </div>

        <div style={{ marginTop: "0.25rem", fontSize: "0.8rem", color: "var(--text-secondary)" }}>
          {t.e2ee_result_hint}
        </div>

        <EnvelopePreview text={envelopePreview(m.content, t.e2ee_envelope_empty)} />

        {m.conversation && (
          <div style={{ marginTop: "0.4rem", fontSize: "0.78rem", color: "var(--text-muted)" }}>
            {t.e2ee_conversation_label} <code style={{ fontSize: "0.74rem" }}>{m.conversation}</code>
          </div>
        )}
      </div>
    </div>
  );
}