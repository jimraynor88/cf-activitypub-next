import Link from "next/link";
import { cookies } from "next/headers";
import { getCloudflareContext } from "@/lib/cf";
import { getAuthenticatedActor } from "@/lib/auth";
import {
  getActorById,
  getMlsMessagesByRecipient,
  getMlsKeyPackagesByActor,
  getMlsConversationsByRecipient,
} from "@/lib/db";
import { MLS_CONTEXT } from "@/lib/activitypub/vocab";

// /e2ee — server-side view of the authenticated user's MLS (end-to-end
// encrypted) messages and key packages. Only metadata and ciphertext envelopes
// are shown: this server never decrypts message content.

export const dynamic = "force-dynamic";

function envelopePreview(content: string | null, max = 72): string {
  if (!content) return "(no content)";
  const stripped = content.replace(/\s+/g, "").slice(0, max);
  return stripped.length < content.replace(/\s+/g, "").length ? `${stripped}…` : stripped;
}

export default async function E2EEPage() {
  const cookieStore = await cookies();
  const authToken = cookieStore.get("auth_token")?.value;
  const { env } = getCloudflareContext();

  if (!authToken) {
    return (
      <Shell>
        <h1 style={styles.title}>End-to-end encrypted messages</h1>
        <p style={styles.muted}>
          <Link href="/login" style={styles.link}>Sign in</Link> to view your MLS messages
          and key packages.
        </p>
      </Shell>
    );
  }

  const actor = await getAuthenticatedActor(
    new Request("https://local/", { headers: { Cookie: `auth_token=${encodeURIComponent(authToken)}` } }),
    env.DB
  );

  if (!actor) {
    return (
      <Shell>
        <h1 style={styles.title}>End-to-end encrypted messages</h1>
        <p style={styles.muted}>
          Session expired. <Link href="/login" style={styles.link}>Sign in again</Link>.
        </p>
      </Shell>
    );
  }

  const domain = new URL(getBaseUrlFromEnv(env)).hostname;
  const keyPackages = await getMlsKeyPackagesByActor(env.DB, actor.id);
  const messages = await getMlsMessagesByRecipient(env.DB, actor.id, 100);
  const [conversations, senderMap] = await Promise.all([
    getMlsConversationsByRecipient(env.DB, actor.id),
    resolveSenders(env.DB, actor.id, messages),
  ]);

  const messagesUrl = `${getBaseUrlFromEnv(env)}/users/${actor.username}/messages`;
  const keyPackagesUrl = `${getBaseUrlFromEnv(env)}/users/${actor.username}/keyPackages`;

  return (
    <Shell>
      <header style={styles.header}>
        <div>
          <h1 style={styles.title}>End-to-end encrypted messages</h1>
          <p style={styles.muted}>
            MLS over ActivityPub · <code style={styles.code}>{actor.username}@{domain}</code>
          </p>
        </div>
        <div style={styles.headerMeta}>
          <div style={styles.stat}>
            <strong>{messages.length}</strong> envelopes
          </div>
          <div style={styles.stat}>
            <strong>{keyPackages.length}</strong> key packages
          </div>
          <div style={styles.stat}>
            <strong>{conversations.length}</strong> conversations
          </div>
        </div>
      </header>

      <section style={styles.section}>
        <h2 style={styles.sectionTitle}>ActivityPub endpoints</h2>
        <p style={styles.muted}>
          These collections are served over ActivityPub so any MLS client can
          fetch your key packages and deliver messages to you (context:{" "}
          <code style={styles.code}>{MLS_CONTEXT}</code>).
        </p>
        <ul style={styles.linkList}>
          <li>
            <Link href={keyPackagesUrl} style={styles.link}>keyPackages</Link>
            <span style={styles.muted}> — RFC 9420 key packages others use to encrypt to you</span>
          </li>
          <li>
            <Link href={messagesUrl} style={styles.link}>messages</Link>
            <span style={styles.muted}> — encrypted envelopes delivered to you</span>
          </li>
        </ul>
      </section>

      <section style={styles.section}>
        <h2 style={styles.sectionTitle}>Key packages</h2>
        {keyPackages.length === 0 ? (
          <p style={styles.muted}>No key packages published yet.</p>
        ) : (
          <table style={styles.table}>
            <thead>
              <tr>
                <th>Status</th>
                <th>Ciphersuite</th>
                <th>Encoding</th>
                <th>Envelope</th>
                <th>Published</th>
              </tr>
            </thead>
            <tbody>
              {keyPackages.map((kp) => (
                <tr key={kp.id}>
                  <td>
                    <span style={kp.isActive ? styles.badgeOk : styles.badgeOff}>
                      {kp.isActive ? "active" : "retired"}
                    </span>
                  </td>
                  <td><code style={styles.code}>{kp.ciphersuite ?? "—"}</code></td>
                  <td><code style={styles.code}>{kp.encoding ?? "—"}</code></td>
                  <td><code style={styles.code}>{envelopePreview(kp.content)}</code></td>
                  <td style={styles.muted}>{new Date(kp.createdAt).toLocaleString()}</td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </section>

      <section style={styles.section}>
        <h2 style={styles.sectionTitle}>Received messages</h2>
        {conversations.length > 0 && (
          <p style={styles.muted}>
            Conversations:{" "}
            {conversations.map((c) => (
              <code key={c.conversation} style={styles.code}>{c.conversation}</code>
            )).join(" · ")}
          </p>
        )}
        {messages.length === 0 ? (
          <p style={styles.muted}>No MLS messages received yet.</p>
        ) : (
          <table style={styles.table}>
            <thead>
              <tr>
                <th>Activity</th>
                <th>Object</th>
                <th>Sender</th>
                <th>Conversation</th>
                <th>Envelope</th>
                <th>Received</th>
              </tr>
            </thead>
            <tbody>
              {messages.map((m) => (
                <tr key={`${m.recipientId}:${m.id}`}>
                  <td><code style={styles.code}>{m.type}</code></td>
                  <td><code style={styles.code}>{m.objectType ?? "—"}</code></td>
                  <td>{senderMap.get(m.actorId) ?? m.actorId}</td>
                  <td>
                    {m.conversation
                      ? <code style={styles.code}>{m.conversation}</code>
                      : <span style={styles.muted}>—</span>}
                  </td>
                  <td><code style={styles.code}>{envelopePreview(m.content)}</code></td>
                  <td style={styles.muted}>{new Date(m.published).toLocaleString()}</td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </section>

      <p style={styles.footnote}>
        This server stores and relays ciphertext envelopes only. Decryption
        happens entirely in your MLS client.
      </p>
    </Shell>
  );
}

async function resolveSenders(
  db: import("@cloudflare/workers-types").D1Database,
  localId: string,
  messages: Awaited<ReturnType<typeof getMlsMessagesByRecipient>>
): Promise<Map<string, string>> {
  const map = new Map<string, string>();
  const ids = [...new Set(messages.map((m) => m.actorId).filter((id) => id && id !== localId))];
  for (const id of ids) {
    const actor = await getActorById(db, id);
    map.set(id, actor ? `@${actor.username}@${actor.domain}` : id);
  }
  return map;
}

function getBaseUrlFromEnv(env: { INSTANCE_URL?: string }): string {
  return env.INSTANCE_URL ?? "http://localhost:3000";
}

function Shell({ children }: { children: React.ReactNode }) {
  return (
    <div style={styles.page}>
      <div style={styles.card}>{children}</div>
    </div>
  );
}

const styles: Record<string, React.CSSProperties> = {
  page: {
    fontFamily: "system-ui, -apple-system, sans-serif",
    background: "#0f1115",
    color: "#e6e6e6",
    minHeight: "100vh",
    padding: 24,
  },
  card: {
    maxWidth: 920,
    margin: "0 auto",
    background: "#171a21",
    border: "1px solid #262b36",
    borderRadius: 12,
    padding: 24,
  },
  header: {
    display: "flex",
    justifyContent: "space-between",
    alignItems: "flex-start",
    gap: 16,
    flexWrap: "wrap",
  },
  headerMeta: { display: "flex", gap: 16, flexWrap: "wrap" },
  stat: {
    background: "#20242e",
    border: "1px solid #2a3040",
    borderRadius: 8,
    padding: "6px 12px",
    fontSize: 13,
  },
  title: { fontSize: 24, margin: "0 0 4px" },
  section: { marginTop: 28 },
  sectionTitle: { fontSize: 16, margin: "0 0 8px", color: "#9fb6ff" },
  muted: { color: "#8b93a7", fontSize: 13, margin: 0 },
  link: { color: "#7aa2ff", textDecoration: "none" },
  linkList: { listStyle: "none", padding: 0, display: "grid", gap: 8 },
  code: {
    background: "#20242e",
    border: "1px solid #2a3040",
    borderRadius: 4,
    padding: "1px 5px",
    fontSize: 12,
  },
  table: {
    width: "100%",
    borderCollapse: "collapse",
    fontSize: 13,
    marginTop: 8,
  },
  badgeOk: {
    background: "#0f3d2e",
    color: "#4ade80",
    border: "1px solid #14532d",
    borderRadius: 999,
    padding: "1px 8px",
    fontSize: 11,
  },
  badgeOff: {
    background: "#3b1d1d",
    color: "#f87171",
    border: "1px solid #7f1d1d",
    borderRadius: 999,
    padding: "1px 8px",
    fontSize: 11,
  },
  footnote: { marginTop: 28, fontSize: 12, color: "#5a6273" },
};
