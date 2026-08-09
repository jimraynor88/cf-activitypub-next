import Link from "next/link";
import Image from "next/image";
import { cookies } from "next/headers";
import { getCloudflareContext } from "@/lib/cf";
import { getAuthenticatedActor } from "@/lib/auth";
import {
  getActorById,
  getMlsMessagesByRecipient,
  getMlsKeyPackagesByActor,
  getMlsConversationsByRecipient,
} from "@/lib/db";
import type { LocalMlsMessage } from "@/lib/types";
import { MLS_CONTEXT } from "@/lib/activitypub/vocab";
import { PageLayout } from "@/components/PageLayout";
import { Sidebar } from "@/components/Sidebar";

// /e2ee — vista del usuario autenticado sobre sus mensajes MLS y key packages.
// Solo se muestran metadatos y envoltorios de cifrado: este servidor nunca
// descifra el contenido de los mensajes.

export const dynamic = "force-dynamic";

interface Sender {
  username: string;
  acct: string;
  displayName: string;
  avatarUrl: string | null;
}

function getBaseUrl(env: { INSTANCE_URL?: string }): string {
  return env.INSTANCE_URL ?? "http://localhost:3000";
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

function envelopePreview(content: string | null): string {
  if (!content) return "(sin contenido)";
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

function MlsMessageRow({ m, sender }: { m: LocalMlsMessage; sender: Sender }) {
  return (
    <div className="status-card flex gap-3" style={{ alignItems: "flex-start", padding: "1rem" }}>
      <Avatar sender={sender} />
      <div className="flex-1" style={{ minWidth: 0 }}>
        <div style={{ display: "flex", alignItems: "center", gap: "0.5rem", flexWrap: "wrap" }}>
          <span style={{ fontWeight: 600, fontSize: "0.92rem" }}>{sender.displayName || sender.username}</span>
          <span style={{ fontSize: "0.8rem", color: "var(--text-muted)" }}>@{sender.acct}</span>
          <span
            className="badge badge-accent"
            style={{ flexShrink: 0 }}
            title="MLS (Messaging Layer Security)"
          >
            🔒 MLS
          </span>
          <span
            className="badge"
            style={{
              background: "var(--bg-elevated)",
              color: "var(--text-secondary)",
              border: "1px solid var(--border)",
            }}
          >
            {m.type}
          </span>
          <span style={{ marginLeft: "auto", fontSize: "0.78rem", color: "var(--text-muted)" }}>
            {formatRelativeTime(m.published)}
          </span>
        </div>

        <div style={{ marginTop: "0.25rem", fontSize: "0.88rem", color: "var(--text-secondary)" }}>
          <span style={{ fontWeight: 600, color: "var(--text-primary)" }}>
            {m.objectType === "Welcome"
              ? "Mensaje de bienvenida protegido"
              : m.objectType === "GroupInfo"
              ? "Información de grupo cifrada"
              : m.objectType === "PrivateMessage"
              ? "Mensaje privado cifrado"
              : m.objectType === "PublicMessage"
              ? "Mensaje público cifrado"
              : m.objectType === "KeyPackage"
              ? "Clave de cifrado"
              : m.type === "Delete"
              ? "Mensaje eliminado"
              : (m.objectType ?? "Actividad MLS")}
          </span>
          {m.objectType === "Welcome" && (
            <span style={{ marginLeft: "0.5rem", color: "var(--text-muted)", fontSize: "0.82rem" }}>
              (te han invitado a un grupo)
            </span>
          )}
        </div>

        <div style={{ marginTop: "0.25rem", fontSize: "0.8rem", color: "var(--text-secondary)" }}>
          Envoltura cifrada, destinada a ti.
        </div>

        <EnvelopePreview text={envelopePreview(m.content)} />

        {m.conversation && (
          <div style={{ marginTop: "0.4rem", fontSize: "0.78rem", color: "var(--text-muted)" }}>
            Conversación: <code style={{ fontSize: "0.74rem" }}>{m.conversation}</code>
          </div>
        )}
      </div>
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

export default async function E2EEPage() {
  const cookieStore = await cookies();
  const authToken = cookieStore.get("auth_token")?.value;
  const { env } = getCloudflareContext();
  const baseUrl = getBaseUrl(env);

  let actor = null;
  if (authToken) {
    actor = await getAuthenticatedActor(
      new Request("https://local/", { headers: { Cookie: `auth_token=${encodeURIComponent(authToken)}` } }),
      env.DB
    );
  }

  if (!actor) {
    return (
      <PageLayout sidebar={<Sidebar me={null} currentPath="/e2ee" />}>
        <div className="flex flex-col items-center justify-center" style={{ padding: "5rem 2rem", textAlign: "center", color: "var(--text-muted)" }}>
          <span style={{ fontSize: "3rem", marginBottom: "1rem" }}>🔒</span>
          <h2 style={{ margin: 0 }}>Mensajes cifrados de extremo a extremo</h2>
          <p style={{ maxWidth: 420, fontSize: "0.9rem" }}>
            Esta pantalla muestra los mensajes y <code>key packages</code> MLS de tu cuenta.{" "}
            <Link href="/login">Inicia sesión</Link> para verlos.
          </p>
        </div>
      </PageLayout>
    );
  }

  const hostname = new URL(baseUrl).hostname;
  const keyPackages = await getMlsKeyPackagesByActor(env.DB, actor.id);
  const messages = await getMlsMessagesByRecipient(env.DB, actor.id, 100);
  const [conversations, senders] = await Promise.all([
    getMlsConversationsByRecipient(env.DB, actor.id),
    resolveSenders(env.DB, actor.id, messages, hostname),
  ]);

  const me = {
    username: actor.username,
    display_name: actor.displayName ?? actor.username,
    acct: actor.username,
  };

  const keyPackagesUrl = `${baseUrl}/users/${actor.username}/keyPackages`;
  const messagesUrl = `${baseUrl}/users/${actor.username}/messages`;
  const conversationsPreview = conversations.map((c) => c.conversation).join(" · ");

  return (
    <PageLayout sidebar={<Sidebar me={me} currentPath="/e2ee" />}>
      {/* Cabecera */}
      <div style={{ padding: "1.25rem 1rem", borderBottom: "1px solid var(--border)", background: "var(--bg-surface)" }}>
        <div style={{ display: "flex", alignItems: "flex-start", justifyContent: "space-between", gap: "1rem", flexWrap: "wrap" }}>
          <div style={{ minWidth: 0 }}>
            <h1 style={{ fontSize: "1.35rem", margin: 0, display: "flex", alignItems: "center", gap: "0.5rem", flexWrap: "wrap" }}>
              🔒 Mensajes cifrados
              <span className="badge badge-accent">MLS · RFC 9420</span>
            </h1>
            <p style={{ margin: "0.25rem 0 0", color: "var(--text-muted)", fontSize: "0.85rem" }}>
              Mensajes protegidos de extremo a extremo para{" "}
              <strong style={{ color: "var(--text-primary)" }}>@{actor.username}@{hostname}</strong>
            </p>
          </div>
          <div style={{ display: "flex", gap: "0.75rem", flexWrap: "wrap" }}>
            <div className="card" style={{ padding: "0.5rem 0.85rem", textAlign: "center", borderRadius: "var(--radius)" }}>
              <div style={{ fontWeight: 700, fontSize: "1.1rem" }}>{messages.length}</div>
              <div style={{ fontSize: "0.72rem", color: "var(--text-muted)" }}>mensajes</div>
            </div>
            <div className="card" style={{ padding: "0.5rem 0.85rem", textAlign: "center", borderRadius: "var(--radius)" }}>
              <div style={{ fontWeight: 700, fontSize: "1.1rem" }}>{keyPackages.length}</div>
              <div style={{ fontSize: "0.72rem", color: "var(--text-muted)" }}>key packages</div>
            </div>
            <div className="card" style={{ padding: "0.5rem 0.85rem", textAlign: "center", borderRadius: "var(--radius)" }}>
              <div style={{ fontWeight: 700, fontSize: "1.1rem" }}>{conversations.length}</div>
              <div style={{ fontSize: "0.72rem", color: "var(--text-muted)" }}>conversaciones</div>
            </div>
          </div>
        </div>

        <div style={{ marginTop: "0.75rem", display: "flex", gap: "0.5rem", flexWrap: "wrap", fontSize: "0.82rem", color: "var(--text-muted)" }}>
          <span>Endpoints ActivityPub:</span>
          <Link href={keyPackagesUrl} style={{ wordBreak: "break-all" }}>keyPackages</Link>
          <span>·</span>
          <Link href={messagesUrl} style={{ wordBreak: "break-all" }}>messages</Link>
          <span>· contexto <code style={{ fontSize: "0.75rem" }}>{MLS_CONTEXT}</code></span>
        </div>
      </div>

      {/* Key packages */}
      <section>
        <div style={{ display: "flex", alignItems: "center", gap: "0.5rem", padding: "0.9rem 1rem", borderBottom: "1px solid var(--border)" }}>
          <h2 style={{ margin: 0, fontSize: "0.95rem", fontWeight: 600 }}>
            Key packages <span style={{ color: "var(--text-muted)", fontWeight: 400 }}>(los demás te cifran con ellos)</span>
          </h2>
        </div>
        {keyPackages.length === 0 ? (
          <EmptyState
            icon="🗝️"
            title="Aún no has publicado ningún key package"
            sub="Publícalo vía tu outbox (Create(KeyPackage)) para que otros usuarios puedan cifrarte mensajes."
          />
        ) : (
          keyPackages.map((kp) => (
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
                    {kp.isActive ? "activo" : "retirado"}
                  </span>
                  <span className="badge" style={{ background: "var(--bg-elevated)", border: "1px solid var(--border)", color: "var(--text-secondary)" }}>
                    {kp.ciphersuite ?? "MLS"}
                  </span>
                  <span style={{ marginLeft: "auto", fontSize: "0.78rem", color: "var(--text-muted)" }}>
                    {formatRelativeTime(kp.createdAt)}
                  </span>
                </div>
                <EnvelopePreview text={envelopePreview(kp.content)} />
              </div>
            </div>
          ))
        )}
      </section>

      {/* Mensajes */}
      <section>
        <div style={{ display: "flex", alignItems: "center", gap: "0.5rem", padding: "0.9rem 1rem", borderBottom: "1px solid var(--border)" }}>
          <h2 style={{ margin: 0, fontSize: "0.95rem", fontWeight: 600 }}>Mensajes recibidos</h2>
          {conversations.length > 0 && (
            <span style={{ fontSize: "0.78rem", color: "var(--text-muted)", overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap", flex: 1, minWidth: 0 }}>
              · {conversationsPreview}
            </span>
          )}
        </div>
        {messages.length === 0 ? (
          <EmptyState
            icon="💬"
            title="No has recibido ningún mensaje MLS"
            sub="Cuando alguien cifre un mensaje para ti, el envoltorio llegará aquí."
          />
        ) : (
          messages.map((m) => (
            <MlsMessageRow
              key={`${m.recipientId}:${m.id}`}
              m={m}
              sender={senders.get(m.actorId) ?? { username: m.actorId, acct: m.actorId, displayName: m.actorId, avatarUrl: null }}
            />
          ))
        )}
      </section>

      <div style={{ padding: "1rem", fontSize: "0.78rem", color: "var(--text-muted)" }}>
        Este servidor solo almacena y reenvía envoltorios de cifrado. El descifrado ocurre íntegramente en tu cliente MLS.
      </div>
    </PageLayout>
  );
}

async function resolveSenders(
  db: import("@cloudflare/workers-types").D1Database,
  localActorId: string,
  messages: LocalMlsMessage[],
  hostname: string
): Promise<Map<string, Sender>> {
  const map = new Map<string, Sender>();
  const ids = [...new Set(messages.map((m) => m.actorId).filter((id) => id && id !== localActorId))];
  for (const id of ids) {
    const actor = await getActorById(db, id);
    if (actor) {
      const local = actor.isLocal && actor.domain === hostname;
      map.set(id, {
        username: actor.username,
        acct: local ? actor.username : `${actor.username}@${actor.domain}`,
        displayName: actor.displayName ?? actor.username,
        avatarUrl: actor.avatarUrl,
      });
    } else {
      map.set(id, { username: id, acct: id, displayName: id, avatarUrl: null });
    }
  }
  return map;
}