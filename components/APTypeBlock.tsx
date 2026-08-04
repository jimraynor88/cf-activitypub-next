"use client";

import Link from "next/link";
import Image from "next/image";

/**
 * ActivityStreams type-specific renderer.
 * Given the underlying `ap_type` of a status plus its extracted `ap_meta`,
 * renders a contextual block: Event card, Place card, Article/Page header,
 * embedded top-level media, and a subtle type badge for non-Note objects.
 */

export interface APMeta {
  name?: string | null;
  startTime?: string | null;
  endTime?: string | null;
  duration?: number | null;
  location?: string | null;
  latitude?: number | null;
  longitude?: number | null;
  url?: string | null;
}

export interface APBlockMedia {
  id: string;
  type: string;
  url: string;
  preview_url?: string | null;
  description?: string | null;
}

const TYPE_LABELS: Record<string, string> = {
  Article: "Artículo",
  Audio: "Audio",
  Document: "Documento",
  Event: "Evento",
  Image: "Imagen",
  Page: "Página",
  Place: "Lugar",
  Video: "Vídeo",
  Question: "Encuesta",
  Note: "Nota",
};

function formatDateTime(iso: string | null | undefined): string {
  if (!iso) return "";
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return "";
  return d.toLocaleString(undefined, { dateStyle: "medium", timeStyle: "short" });
}

function formatDuration(sec: number): string {
  const h = Math.floor(sec / 3600);
  const m = Math.floor((sec % 3600) / 60);
  const s = Math.floor(sec % 60);
  if (h > 0) return `${h}h ${m}m`;
  if (m > 0) return `${m}m ${s}s`;
  return `${s}s`;
}

function badgeStyle() {
  return {
    display: "inline-block",
    fontSize: "0.68rem",
    fontWeight: 600,
    textTransform: "uppercase" as const,
    letterSpacing: "0.04em",
    color: "var(--accent)",
    background: "var(--accent-bg)",
    border: "1px solid color-mix(in srgb, var(--accent) 30%, transparent)",
    borderRadius: "999px",
    padding: "0.1rem 0.5rem",
    marginBottom: "0.35rem",
  };
}

function cardStyle() {
  return {
    border: "1px solid var(--border)",
    borderRadius: "var(--radius)",
    background: "var(--bg-elevated)",
    padding: "0.75rem 0.875rem",
    marginTop: "0.6rem",
    display: "flex" as const,
    flexDirection: "column" as const,
    gap: "0.35rem",
  };
}

function isMediaUrl(url: string): boolean {
  return /\.(mp4|webm|ogg|ogv|mov|m4v|mp3|oga|wav|flac|m4a|jpg|jpeg|png|gif|webp|bmp|avif)(#|\?|$)/i.test(url);
}

export function TypeBadge({ apType }: { apType?: string | null }) {
  if (!apType || apType === "Note") return null;
  return <span style={badgeStyle()}>{TYPE_LABELS[apType] ?? apType}</span>;
}

export function APTypeBlock({
  apType,
  apMeta,
  mediaAttachments = [],
}: {
  apType?: string | null;
  apMeta?: APMeta | null;
  mediaAttachments?: APBlockMedia[];
}) {
  if (!apType || apType === "Note") return null;

  // ── Event ────────────────────────────────────────────────────────────────
  if (apType === "Event") {
    const start = formatDateTime(apMeta?.startTime);
    const end = formatDateTime(apMeta?.endTime);
    const title = apMeta?.name;
    return (
      <div style={cardStyle()}>
        {title && (
          <span style={{ fontWeight: 600, fontSize: "0.95rem", color: "var(--text)" }}>📅 {title}</span>
        )}
        {start && <span style={{ fontSize: "0.85rem", color: "var(--text-secondary)" }}>🕑 {start}{end ? ` → ${end}` : ""}</span>}
        {apMeta?.location && <span style={{ fontSize: "0.85rem", color: "var(--text-secondary)" }}>📍 {apMeta.location}</span>}
        {apMeta?.duration && (
          <span style={{ fontSize: "0.8rem", color: "var(--text-muted)" }} className="flex items-center gap-1">
            ⏱ {formatDuration(apMeta.duration)}
          </span>
        )}
        {apMeta?.url && <Link href={apMeta.url} target="_blank" rel="nofollow noopener noreferrer" style={{ fontSize: "0.85rem", color: "var(--accent)", textDecoration: "none" }}>Abrir evento →</Link>}
      </div>
    );
  }

  // ── Place ────────────────────────────────────────────────────────────────
  if (apType === "Place") {
    const hasCoords = apMeta?.latitude != null && apMeta?.longitude != null;
    const mapsUrl = hasCoords
      ? `https://www.openstreetmap.org/?mlat=${apMeta!.latitude}&mlon=${apMeta!.longitude}#map=16/${apMeta!.latitude}/${apMeta!.longitude}`
      : undefined;
    return (
      <div style={cardStyle()}>
        <span style={{ fontWeight: 600, fontSize: "0.95rem", color: "var(--text)" }}>📍 {apMeta?.name ?? "Lugar"}</span>
        {hasCoords && (
          <span style={{ fontSize: "0.8rem", color: "var(--text-muted)" }}>{apMeta!.latitude!.toFixed(5)}, {apMeta!.longitude!.toFixed(5)}</span>
        )}
        {mapsUrl && (
          <Link href={mapsUrl} target="_blank" rel="nofollow noopener noreferrer" style={{ fontSize: "0.85rem", color: "var(--accent)", textDecoration: "none" }}>Ver en el mapa →</Link>
        )}
        {apMeta?.url && !mapsUrl && (
          <Link href={apMeta.url} target="_blank" rel="nofollow noopener noreferrer" style={{ fontSize: "0.85rem", color: "var(--accent)", textDecoration: "none" }}>Abrir lugar →</Link>
        )}
      </div>
    );
  }

  // ── Article / Page / Document: show a title header linking out ──────────
  if (apType === "Article" || apType === "Page" || apType === "Document") {
    if (!apMeta?.name) return null;
    return (
      <header style={{ marginBottom: "0.15rem" }}>
        <Link
          href={apMeta.url ?? "#"}
          target={apMeta.url ? "_blank" : undefined}
          rel={apMeta.url ? "nofollow noopener noreferrer" : undefined}
          style={{ display: "block", fontWeight: 650, fontSize: "1.05rem", lineHeight: 1.35, color: "var(--text)", textDecoration: "none" }}
        >
          {apMeta.name}
        </Link>
        {apMeta.name && apMeta.url && (
          <span style={{ fontSize: "0.78rem", color: "var(--text-muted)" }}>{new URL(apMeta.url).hostname}</span>
        )}
      </header>
    );
  }

  // ── Top-level media (Audio / Video / Image objects with no attachments) ─
  if (apType === "Audio" || apType === "Video" || apType === "Image") {
    if (mediaAttachments.length > 0) return null; // rendered by MediaGrid
    const src = apMeta?.url;
    if (!src || !isMediaUrl(src)) return null;
    if (apType === "Image") {
      return (
        <div style={{ marginTop: "0.6rem", borderRadius: "var(--radius)", overflow: "hidden", border: "1px solid var(--border)" }}>
          <Image src={src} alt={apMeta.name ?? ""} width={640} height={360} style={{ width: "100%", objectFit: "cover" }} />
        </div>
      );
    }
    return (
      <div style={{ marginTop: "0.6rem" }}>
        {apType === "Video" ? (
          <video src={src} controls playsInline style={{ width: "100%", borderRadius: "var(--radius)", maxHeight: 420 }} />
        ) : (
          <audio src={src} controls style={{ width: "100%" }} />
        )}
      </div>
    );
  }

  return null;
}