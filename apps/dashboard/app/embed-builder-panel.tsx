"use client";

import { useMemo, useState } from "react";

type Props = { guildId: string; channels: Array<{ id: string; name: string }>; onChanged?: () => void | Promise<void> };

export function EmbedBuilderPanel({ guildId, channels, onChanged }: Props) {
  const [channelId, setChannelId] = useState(channels[0]?.id ?? "");
  const [title, setTitle] = useState("");
  const [description, setDescription] = useState("");
  const [url, setUrl] = useState("");
  const [color, setColor] = useState("#5865F2");
  const [footer, setFooter] = useState("");
  const [image, setImage] = useState("");
  const [thumbnail, setThumbnail] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");

  const preview = useMemo(() => ({ title, description, url, color, footer, image, thumbnail }), [title,description,url,color,footer,image,thumbnail]);

  async function publish() {
    setBusy(true);
    setError("");
    try {
      const response = await fetch("/api/guilds/" + encodeURIComponent(guildId) + "/embed", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ channelId, ...preview })
      });
      const body = await response.json().catch(() => ({}));
      if (!response.ok) throw new Error(body.error ?? "embed_publish_failed");
      await onChanged?.();
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : "Не удалось опубликовать embed.");
    } finally {
      setBusy(false);
    }
  }

  return (
    <div style={{ display: "grid", gridTemplateColumns: "minmax(0,1fr) minmax(280px,.7fr)", gap: 14 }}>
      <div style={{ display: "grid", gap: 8 }}>
        <select value={channelId} onChange={(e) => setChannelId(e.target.value)} style={inputStyle}>
          {channels.map((channel) => <option key={channel.id} value={channel.id}>{channel.name}</option>)}
        </select>
        <input value={title} maxLength={256} onChange={(e) => setTitle(e.target.value)} placeholder="Title" style={inputStyle} />
        <textarea value={description} maxLength={4096} onChange={(e) => setDescription(e.target.value)} placeholder="Description" rows={7} style={inputStyle} />
        <div style={grid2}>
          <input value={url} maxLength={2000} onChange={(e) => setUrl(e.target.value)} placeholder="URL" style={inputStyle} />
          <input value={color} maxLength={7} onChange={(e) => setColor(e.target.value)} placeholder="#5865F2" style={inputStyle} />
          <input value={footer} maxLength={2048} onChange={(e) => setFooter(e.target.value)} placeholder="Footer" style={inputStyle} />
          <input value={image} maxLength={2000} onChange={(e) => setImage(e.target.value)} placeholder="Image URL" style={inputStyle} />
          <input value={thumbnail} maxLength={2000} onChange={(e) => setThumbnail(e.target.value)} placeholder="Thumbnail URL" style={inputStyle} />
        </div>
        {error && <div style={errorStyle}>{error}</div>}
        <button type="button" disabled={busy || !channelId} onClick={() => void publish()} style={buttonStyle}>{busy ? "Публикуем…" : "Опубликовать"}</button>
      </div>

      <div style={{ border: "1px solid #2b3340", borderRadius: 12, padding: 14, background: "#0c1016", borderLeft: "4px solid " + (/^#[0-9a-fA-F]{6}$/.test(preview.color) ? preview.color : "#5865F2") }}>
        <div style={{ opacity: 0.45, fontSize: 9, letterSpacing: 1.2 }}>PREVIEW</div>
        {preview.title && <div style={{ marginTop: 8, fontWeight: 750, fontSize: 16 }}>{preview.title}</div>}
        {preview.description && <div style={{ marginTop: 8, color: "#c8ced8", whiteSpace: "pre-wrap", lineHeight: 1.5, fontSize: 12 }}>{preview.description}</div>}
        {preview.url && <div style={{ marginTop: 8, color: "#7ca8ff", fontSize: 10, overflowWrap: "anywhere" }}>{preview.url}</div>}
        {preview.image && <div style={{ marginTop: 10, color: "#697486", fontSize: 10 }}>Image: {preview.image}</div>}
        {preview.thumbnail && <div style={{ marginTop: 6, color: "#697486", fontSize: 10 }}>Thumbnail: {preview.thumbnail}</div>}
        {preview.footer && <div style={{ marginTop: 14, paddingTop: 9, borderTop: "1px solid #202632", color: "#6d7889", fontSize: 10 }}>{preview.footer}</div>}
      </div>
    </div>
  );
}

const inputStyle = {
  width: "100%",
  boxSizing: "border-box" as const,
  background: "#0d1118",
  color: "#f4f6fa",
  border: "1px solid #303846",
  borderRadius: 9,
  padding: "9px 10px"
} as const;
const grid2 = { display: "grid", gridTemplateColumns: "repeat(2,minmax(0,1fr))", gap: 8 } as const;
const buttonStyle = { border: "1px solid #5865f2", background: "#5865f2", color: "#fff", borderRadius: 9, padding: "10px 12px", cursor: "pointer" } as const;
const errorStyle = { padding: 9, borderRadius: 9, background: "#32191b", border: "1px solid #63292d" } as const;
