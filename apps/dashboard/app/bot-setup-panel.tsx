"use client";

import { useEffect, useState } from "react";

type BotSetup = {
  id?: string;
  enabled: boolean;
  clientId: string;
  username: string | null;
  presenceName: string | null;
  avatarUrl: string | null;
  bannerUrl: string | null;
};

const inputStyle = {
  width: "100%",
  boxSizing: "border-box" as const,
  background: "#0b1016",
  color: "#eef2f7",
  border: "1px solid #303946",
  borderRadius: 9,
  padding: "10px 11px",
  outline: "none"
};

export function BotSetupPanel() {
  const [setup, setSetup] = useState<BotSetup>({
    enabled: false,
    clientId: "",
    username: null,
    presenceName: null,
    avatarUrl: null,
    bannerUrl: null
  });
  const [token, setToken] = useState("");
  const [presenceName, setPresenceName] = useState("");
  const [username, setUsername] = useState("");
  const [avatarData, setAvatarData] = useState<string | null>(null);
  const [bannerData, setBannerData] = useState<string | null>(null);
  const [enabled, setEnabled] = useState(false);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [message, setMessage] = useState("");
  const [error, setError] = useState("");

  async function load() {
    setLoading(true);
    setError("");
    try {
      const response = await fetch("/api/bot", { cache: "no-store" });
      const body = await response.json().catch(() => ({}));
      if (!response.ok) throw new Error(body.error ?? "bot_setup_load_failed");
      const value = body.bot as BotSetup;
      setSetup(value);
      setClientFields(value);
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : "Не удалось загрузить настройки бота.");
    } finally {
      setLoading(false);
    }
  }

  function setClientFields(value: BotSetup) {
    setEnabled(Boolean(value.enabled));
    setPresenceName(value.presenceName ?? "");
    setUsername(value.username ?? "");
  }

  async function readImage(file: File): Promise<string> {
    if (!["image/png", "image/jpeg", "image/gif"].includes(file.type)) {
      throw new Error("Разрешены только PNG, JPEG и GIF.");
    }
    if (file.size > 3 * 1024 * 1024) {
      throw new Error("Файл не должен быть больше 3 MB.");
    }
    return await new Promise((resolve, reject) => {
      const reader = new FileReader();
      reader.onerror = () => reject(new Error("Не удалось прочитать изображение."));
      reader.onload = () => {
        const result = reader.result;
        if (typeof result !== "string" || !/^data:image\/(png|jpeg|gif);base64,/i.test(result)) {
          reject(new Error("Некорректный формат изображения."));
          return;
        }
        resolve(result);
      };
      reader.readAsDataURL(file);
    });
  }

  async function pickImage(file: File | undefined, setter: (value: string | null) => void) {
    if (!file) {
      setter(null);
      return;
    }
    try {
      setter(await readImage(file));
      setError("");
    } catch (caught) {
      setter(null);
      setError(caught instanceof Error ? caught.message : "Не удалось загрузить изображение.");
    }
  }


  useEffect(() => { void load(); }, []);

  async function testCredentials() {
    if (!/^\d{17,20}$/.test(setup.clientId) || !token) {
      setError("Для проверки нужны Client ID и текущий token.");
      return;
    }
    setSaving(true);
    setError("");
    setMessage("");
    try {
      const response = await fetch("/api/bot", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ clientId: setup.clientId, token })
      });
      const body = await response.json().catch(() => ({}));
      if (!response.ok) throw new Error(body.error ?? "bot_credential_test_failed");
      setMessage("Credentials валидны: " + String(body.bot?.username ?? "Discord bot") + ".");
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : "Не удалось проверить credentials.");
    } finally {
      setSaving(false);
    }
  }

  async function save() {
    if (!/^d{17,20}$/.test(setup.clientId)) {
      setError("Client ID должен быть Discord Application ID.");
      return;
    }
    if (!token && !setup.clientId) {
      setError("Добавь Discord bot token.");
      return;
    }

    setSaving(true);
    setError("");
    setMessage("");
    try {
      const response = await fetch("/api/bot", {
        method: "PUT",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          clientId: setup.clientId,
          ...(token ? { token } : {}),
          enabled,
          presenceName: presenceName.trim() || null,
          ...(username.trim() ? { username: username.trim() } : {}),
          ...(avatarData !== null ? { avatarData } : {}),
          ...(bannerData !== null ? { bannerData } : {})
        })
      });
      const body = await response.json().catch(() => ({}));
      if (!response.ok) throw new Error(body.error ?? "bot_registration_failed");
      setToken("");
      setMessage("Настройки бота сохранены. При включении бот переподключается с новыми credentials.");
      const next = body.bot as BotSetup | undefined;
      if (next) {
        setSetup(next);
        setClientFields(next);
      } else {
        await load();
      }
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : "Не удалось сохранить credentials бота.");
    } finally {
      setSaving(false);
    }
  }

  return (
    <section style={{ display: "grid", gap: 12, maxWidth: 760 }}>
      <div style={{ padding: 14, border: "1px solid #252d39", borderRadius: 14, background: "#11161e" }}>
        <div style={{ fontSize: 15, fontWeight: 720 }}>Регистрация Discord-бота</div>
        <div style={{ marginTop: 5, color: "#667386", fontSize: 10, lineHeight: 1.5 }}>
          Локальная админка. Token хранится на сервере и после сохранения обратно в Dashboard не возвращается.
        </div>
      </div>

      {error && <div style={{ padding: 10, borderRadius: 10, background: "#32191b", border: "1px solid #63292d", fontSize: 11 }}>{error}</div>}
      {message && <div style={{ padding: 10, borderRadius: 10, background: "#16291c", border: "1px solid #2c5a39", fontSize: 11 }}>{message}</div>}

      <div style={{ display: "grid", gap: 10, padding: 14, border: "1px solid #252d39", borderRadius: 14, background: "#11161e" }}>
        <label style={{ display: "grid", gap: 5, fontSize: 10 }}>
          Discord Application / Client ID
          <input
            value={setup.clientId}
            onChange={(e) => setSetup((value) => ({ ...value, clientId: e.target.value.trim() }))}
            placeholder="123456789012345678"
            inputMode="numeric"
            style={inputStyle}
            disabled={loading || saving}
          />
        </label>

        <label style={{ display: "grid", gap: 5, fontSize: 10 }}>
          Bot Token
          <input
            type="password"
            value={token}
            onChange={(e) => setToken(e.target.value)}
            placeholder="Оставь пустым, чтобы не менять сохранённый token"
            autoComplete="new-password"
            style={inputStyle}
            disabled={loading || saving}
          />
        </label>

        <label style={{ display: "flex", gap: 9, alignItems: "center", fontSize: 10 }}>
          <input type="checkbox" checked={enabled} onChange={(e) => setEnabled(e.target.checked)} disabled={loading || saving} />
          Запускать бота
        </label>

        <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 10 }}>
          <label style={{ display: "grid", gap: 5, fontSize: 10 }}>
            Username
            <input
              value={username}
              onChange={(e) => setUsername(e.target.value)}
              placeholder="Опционально"
              maxLength={32}
              style={inputStyle}
              disabled={loading || saving}
            />
          </label>
          <label style={{ display: "grid", gap: 5, fontSize: 10 }}>
            Presence
            <input
              value={presenceName}
              onChange={(e) => setPresenceName(e.target.value)}
              placeholder="Например: Discord Server Platform"
              maxLength={128}
              style={inputStyle}
              disabled={loading || saving}
            />
          </label>
        </div>

        <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 10 }}>
          <label style={{ display: "grid", gap: 5, fontSize: 10 }}>
            Avatar
            <input
              type="file"
              accept="image/png,image/jpeg,image/gif"
              onChange={(e) => void pickImage(e.target.files?.[0], setAvatarData)}
              disabled={loading || saving}
              style={{ ...inputStyle, padding: "7px 8px" }}
            />
            <span style={{ opacity: 0.42 }}>Оставь пустым, чтобы не менять. До 3 MB.</span>
          </label>
          <label style={{ display: "grid", gap: 5, fontSize: 10 }}>
            Banner
            <input
              type="file"
              accept="image/png,image/jpeg,image/gif"
              onChange={(e) => void pickImage(e.target.files?.[0], setBannerData)}
              disabled={loading || saving}
              style={{ ...inputStyle, padding: "7px 8px" }}
            />
            <span style={{ opacity: 0.42 }}>Оставь пустым, чтобы не менять. До 3 MB.</span>
          </label>
        </div>

        <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 8 }}>
          <button type="button" onClick={() => void testCredentials()} disabled={loading || saving || !token} style={{ ...inputStyle, cursor: saving ? "default" : "pointer", background: "#171e2a" }}>
            {saving ? "Проверка…" : "Проверить credentials"}
          </button>
          <button type="button" onClick={() => void save()} disabled={loading || saving} style={{ ...inputStyle, cursor: saving ? "default" : "pointer", background: saving ? "#1a202a" : "#293767", borderColor: "#3b4b80" }}>
            {saving ? "Сохранение…" : "Сохранить и применить"}
          </button>
        </div>
      </div>

      <div style={{ padding: 14, border: "1px solid #252d39", borderRadius: 14, background: "#11161e" }}>
        <div style={{ fontSize: 11, fontWeight: 700 }}>Текущее состояние</div>
        <div style={{ display: "grid", gap: 5, marginTop: 8, color: "#7b8798", fontSize: 10 }}>
          <div>Статус: {loading ? "…" : enabled ? "включён" : "выключен"}</div>
          <div>Username: {setup.username ?? "—"}</div>
          <div>Client ID: {setup.clientId || "—"}</div>
          <div>Avatar: {setup.avatarUrl ? "настроен" : "—"}</div>
          <div>Banner: {setup.bannerUrl ? "настроен" : "—"}</div>
        </div>
      </div>
    </section>
  );
}
