"use client";

import { useEffect, useState } from "react";

type Resource = { id: string; name: string };
type AutomationChannelType = "text" | "announcement" | "forum" | "voice" | "stage" | "category" | "thread" | "other";
type AutomationPermission = "Administrator" | "ManageGuild" | "ManageChannels" | "ManageRoles" | "ManageMessages" | "KickMembers" | "BanMembers" | "ModerateMembers";

type Condition =
  | { type: "contains" | "equals"; left: string; right: string }
  | { type: "matches"; left: string; pattern: string }
  | { type: "number-gte" | "number-lte"; left: string; right: number }
  | { type: "has-role" | "not-has-role"; userId: string; roleId: string }
  | { type: "channel-is"; channelId: string }
  | { type: "channel-type-is"; channelType: AutomationChannelType }
  | { type: "user-is-bot"; userId: string; value: boolean }
  | { type: "has-permission"; userId: string; permission: AutomationPermission }
  | { type: "cooldown-clear"; key: string };

type Action =
  | { type: "send-message"; channelId: string; content: string }
  | { type: "dm-user"; userId: string; content: string }
  | { type: "add-role" | "remove-role"; userId: string; roleId: string }
  | { type: "timeout"; userId: string; durationSeconds: number; reason: string }
  | { type: "warn" | "kick"; userId: string; reason: string }
  | { type: "ban"; userId: string; durationMinutes?: number; reason: string }
  | { type: "delete-message"; channelId: string; messageId: string }
  | { type: "set-nickname"; userId: string; nickname: string | null }
  | { type: "react-message"; channelId: string; messageId: string; emoji: string }
  | { type: "log"; message: string }
  | { type: "delay"; seconds: number }
  | { type: "webhook"; url: string; content: string }
  | { type: "branch"; condition: Condition; thenActions: Action[]; elseActions: Action[] };

type Template = { name: string; content: string };

type Preset = {
  name: string;
  event: string;
  conditions: Condition[];
  anyConditions: Condition[];
  actions: Action[];
  cooldownSeconds: number;
  updatedAt: string;
};

type Diagnostics = {
  rules: { total: number; enabled: number; byEvent: Record<string, number> };
  templates: { total: number };
  delayedJobs: {
    pending: number;
    processing: number;
    withErrors: number;
    deadLettered: number;
    completed24h: number;
    oldestPendingAt: string | null;
    recent: Array<{
      id: string;
      status: "pending" | "processing" | "completed" | "dead-lettered";
      ruleId: string | null;
      attempts: number;
      availableAt: string;
      processingUntil: string | null;
      lastError: string | null;
      completedAt: string | null;
      createdAt: string;
    }>;
  };
  runtime: {
    loadedRules: number;
    executionCounter: number;
    cooldownKeys: number;
    keyedCooldownKeys: number;
    lastScheduleMinute: number | null;
  };
};


type Rule = {
  id: string;
  name: string;
  enabled: boolean;
  event: string;
  all: Condition[];
  any: Condition[];
  actions: Action[];
  cooldownSeconds: number;
};

const EVENTS = [
  "member.join","member.leave","member.role.add","member.role.remove",
  "message.create","message.delete","message.edit","reaction.add","reaction.remove",
  "channel.delete","role.delete","member.ban",
  "voice.join","voice.leave","voice.move","moderation.case",
  "ticket.create","ticket.close","giveaway.end","schedule"
] as const;

const TEXT_FIELDS = ["content","userId","moderatorUserId","channelId","roleId","action","reason","messageId","guildId"] as const;
const NUMBER_FIELDS = ["memberCount","messageLength","mentionCount","previousLength","caseId","ticketId","giveawayId","winnerCount","timestamp","minute","hour","dayOfWeek","dayOfMonth"] as const;
const CHANNEL_TYPES: AutomationChannelType[] = ["text","announcement","forum","voice","stage","category","thread","other"];
const PERMISSIONS: AutomationPermission[] = ["Administrator","ManageGuild","ManageChannels","ManageRoles","ManageMessages","KickMembers","BanMembers","ModerateMembers"];

export function AutomationPanel({
  guildId,
  channels,
  roles,
  onChanged
}: {
  guildId: string;
  channels: Resource[];
  roles: Resource[];
  onChanged?: () => void | Promise<void>;
}) {
  const [rules, setRules] = useState<Rule[]>([]);
  const [templates, setTemplates] = useState<Template[]>([]);
  const [presets, setPresets] = useState<Preset[]>([]);
  const [presetName, setPresetName] = useState("");
  const [templateName, setTemplateName] = useState("");
  const [templateContent, setTemplateContent] = useState("");
  const [editingId, setEditingId] = useState<string | null>(null);
  const [name, setName] = useState("Новое правило");
  const [event, setEvent] = useState<string>("message.create");
  const [cooldownSeconds, setCooldownSeconds] = useState(0);
  const [enabled, setEnabled] = useState(true);
  const [conditions, setConditions] = useState<Condition[]>([]);
  const [anyConditions, setAnyConditions] = useState<Condition[]>([]);
  const [actions, setActions] = useState<Action[]>([{ type: "send-message", channelId: "", content: "" }]);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState("");
  const [testContent, setTestContent] = useState("Тестовое сообщение");
  const [testUserId, setTestUserId] = useState("");
  const [testChannelId, setTestChannelId] = useState("");
  const [testRoleIds, setTestRoleIds] = useState("");
  const [testUserIsBot, setTestUserIsBot] = useState(false);
  const [testChannelType, setTestChannelType] = useState<AutomationChannelType>("text");
  const [testPermissions, setTestPermissions] = useState("");
  const [testNumeric, setTestNumeric] = useState("{}");
  const [dryRunBusy, setDryRunBusy] = useState(false);
  const [dryRunResult, setDryRunResult] = useState<{ matched: boolean; event: string; renderedActions: Array<{ type: string; preview: string }> } | null>(null);
  const [diagnostics, setDiagnostics] = useState<Diagnostics | null>(null);

  async function load() {
    const [rulesResponse, templatesResponse, presetsResponse, diagnosticsResponse] = await Promise.all([
      fetch("/api/guilds/" + encodeURIComponent(guildId) + "/automation", { cache: "no-store" }),
      fetch("/api/guilds/" + encodeURIComponent(guildId) + "/automation/templates", { cache: "no-store" }),
      fetch("/api/guilds/" + encodeURIComponent(guildId) + "/automation/presets", { cache: "no-store" }),
      fetch("/api/guilds/" + encodeURIComponent(guildId) + "/automation/diagnostics", { cache: "no-store" })
    ]);
    const rulesBody = await rulesResponse.json().catch(() => ({}));
    const templatesBody = await templatesResponse.json().catch(() => ({}));
    const presetsBody = await presetsResponse.json().catch(() => ({}));
    const diagnosticsBody = await diagnosticsResponse.json().catch(() => ({}));
    if (!rulesResponse.ok) throw new Error(rulesBody.error ?? "automation_failed");
    if (!templatesResponse.ok) throw new Error(templatesBody.error ?? "templates_failed");
    if (!presetsResponse.ok) throw new Error(presetsBody.error ?? "presets_failed");
    if (!diagnosticsResponse.ok) throw new Error(diagnosticsBody.error ?? "automation_diagnostics_failed");
    setRules(rulesBody.rules ?? []);
    setTemplates(templatesBody.templates ?? []);
    setPresets(presetsBody.presets ?? []);
    setDiagnostics(diagnosticsBody.diagnostics ?? null);
  }

  useEffect(() => {
    setError("");
    void load().catch(() => setError("Не удалось загрузить automation rules."));
  }, [guildId]);

  function reset() {
    setEditingId(null);
    setName("Новое правило");
    setEvent("message.create");
    setCooldownSeconds(0);
    setEnabled(true);
    setConditions([]);
    setAnyConditions([]);
    setActions([{ type: "send-message", channelId: "", content: "" }]);
    setError("");
  }

  function edit(rule: Rule) {
    setEditingId(rule.id);
    setName(rule.name);
    setEvent(rule.event);
    setCooldownSeconds(rule.cooldownSeconds);
    setEnabled(rule.enabled);
    setConditions(Array.isArray(rule.all) ? rule.all : []);
    setAnyConditions(Array.isArray(rule.any) ? rule.any : []);
    setActions(Array.isArray(rule.actions) ? rule.actions : []);
    setError("");
  }

  async function save() {
    if (!name.trim()) {
      setError("Укажи название правила.");
      return;
    }
    if (
      actions.length < 1 ||
      actions.length > 10 ||
      conditions.length > 10 ||
      anyConditions.length > 10 ||
      conditions.length + anyConditions.length > 10
    ) {
      setError("Нужно максимум 10 условий суммарно и 1–10 действий.");
      return;
    }
    setSaving(true);
    setError("");
    try {
      const url = "/api/guilds/" + encodeURIComponent(guildId) + "/automation" + (editingId ? "/" + encodeURIComponent(editingId) : "");
      const response = await fetch(url, {
        method: editingId ? "PUT" : "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          name: name.trim(),
          event,
          cooldownSeconds,
          enabled,
          conditions,
          anyConditions,
          actions
        })
      });
      const body = await response.json().catch(() => ({}));
      if (!response.ok) throw new Error(body.error ?? "automation_save_failed");
      await load();
      reset();
      await onChanged?.();
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : "Не удалось сохранить правило.");
    } finally {
      setSaving(false);
    }
  }

  async function savePreset() {
    const normalized = presetName.trim();
    if (!normalized) {
      setError("Укажи имя workflow preset.");
      return;
    }
    setSaving(true);
    setError("");
    try {
      const response = await fetch("/api/guilds/" + encodeURIComponent(guildId) + "/automation/presets", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          name: normalized,
          event,
          cooldownSeconds,
          conditions,
          anyConditions,
          actions
        })
      });
      const body = await response.json().catch(() => ({}));
      if (!response.ok) throw new Error(body.error ?? "automation_preset_save_failed");
      setPresetName("");
      await load();
      await onChanged?.();
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : "Не удалось сохранить workflow preset.");
    } finally {
      setSaving(false);
    }
  }

  function loadPreset(preset: Preset) {
    setEditingId(null);
    setName("Новое правило");
    setEvent(preset.event);
    setCooldownSeconds(preset.cooldownSeconds);
    setEnabled(true);
    setConditions(Array.isArray(preset.conditions) ? structuredClone(preset.conditions) : []);
    setAnyConditions(Array.isArray(preset.anyConditions) ? structuredClone(preset.anyConditions) : []);
    setActions(Array.isArray(preset.actions) ? structuredClone(preset.actions) : []);
    setError("");
    window.scrollTo({ top: 0, behavior: "smooth" });
  }

  async function removePreset(presetNameToDelete: string) {
    if (!window.confirm("Удалить этот workflow preset?")) return;
    setSaving(true);
    setError("");
    try {
      const response = await fetch(
        "/api/guilds/" + encodeURIComponent(guildId) + "/automation/presets/" + encodeURIComponent(presetNameToDelete),
        { method: "DELETE" }
      );
      if (!response.ok) throw new Error("automation_preset_delete_failed");
      await load();
      await onChanged?.();
    } catch {
      setError("Не удалось удалить workflow preset.");
    } finally {
      setSaving(false);
    }
  }

  async function remove(ruleId: string) {
    if (!window.confirm("Удалить это automation rule?")) return;
    setSaving(true);
    setError("");
    try {
      const response = await fetch("/api/guilds/" + encodeURIComponent(guildId) + "/automation/" + encodeURIComponent(ruleId), { method: "DELETE" });
      if (!response.ok) throw new Error("automation_delete_failed");
      await load();
      if (editingId === ruleId) reset();
      await onChanged?.();
    } catch {
      setError("Не удалось удалить правило.");
    } finally {
      setSaving(false);
    }
  }

  function updateCondition(index: number, patch: Partial<Condition>, any = false) {
    const setter = any ? setAnyConditions : setConditions;
    setter((current) => current.map((item, i) => i === index ? { ...item, ...patch } as Condition : item));
  }

  function replaceCondition(index: number, type: Condition["type"], any = false) {
    const next: Condition =
      type === "channel-is" ? { type, channelId: "" } :
      type === "matches" ? { type, left: "content", pattern: "" } :
      type === "number-gte" || type === "number-lte" ? { type, left: "memberCount", right: 0 } :
      type === "has-role" || type === "not-has-role" ? { type, userId: "@event", roleId: "" } :
      type === "channel-type-is" ? { type, channelType: "text" } :
      type === "user-is-bot" ? { type, userId: "@event", value: true } :
      type === "has-permission" ? { type, userId: "@event", permission: "ManageGuild" } :
      type === "cooldown-clear" ? { type, key: "" } :
      { type, left: "content", right: "" };
    const setter = any ? setAnyConditions : setConditions;
    setter((current) => current.map((item, i) => i === index ? next : item));
  }

  function updateAction(index: number, patch: Partial<Action>) {
    setActions((current) => current.map((item, i) => i === index ? { ...item, ...patch } as Action : item));
  }

  function replaceAction(index: number, type: Action["type"]) {
    const next: Action =
      type === "send-message" ? { type, channelId: "", content: "" } :
      type === "dm-user" ? { type, userId: "@event", content: "" } :
      type === "add-role" || type === "remove-role" ? { type, userId: "@event", roleId: "" } :
      type === "timeout" ? { type, userId: "@event", durationSeconds: 60, reason: "" } :
      type === "warn" || type === "kick" ? { type, userId: "@event", reason: "" } :
      type === "ban" ? { type, userId: "@event", reason: "" } :
      type === "delete-message" ? { type, channelId: "@event", messageId: "@event" } :
      type === "set-nickname" ? { type, userId: "@event", nickname: "" } :
      type === "react-message" ? { type, channelId: "@event", messageId: "@event", emoji: "👍" } :
      type === "delay" ? { type, seconds: 5 } :
      type === "webhook" ? { type, url: "", content: "" } :
      type === "branch" ? {
        type,
        condition: { type: "contains", left: "content", right: "" } as Condition,
        thenActions: [{ type: "send-message", channelId: "", content: "" }],
        elseActions: []
      } :
      { type: "log", message: "" };
    setActions((current) => current.map((item, i) => i === index ? next : item));
  }

  return (
    <div style={{ display: "grid", gap: 15 }}>
      <div>
        <h3 style={{ margin: 0, fontSize: 17 }}>Automation Builder</h3>
        <div style={{ marginTop: 5, opacity: 0.45, fontSize: 12 }}>
          Полный каталог событий, условий и действий, которые исполняет Core.
        </div>
      </div>

      {error && <div style={{ padding: 10, borderRadius: 10, background: "#32191b", border: "1px solid #63292d" }}>{error}</div>}

      <section style={sectionStyle}>
        <div style={sectionTitle}>Workflow presets · reusable automation</div>
        <div style={{ fontSize: 11, opacity: 0.5 }}>
          Сохраняет текущие event + conditions + actions + cooldown. Пресет можно загрузить в редактор и затем изменить перед публикацией.
        </div>
        <div style={{ display: "grid", gridTemplateColumns: "minmax(0,1fr) auto", gap: 8 }}>
          <input
            value={presetName}
            maxLength={40}
            onChange={(e) => setPresetName(e.target.value)}
            placeholder="welcome_message"
            style={inputStyle}
          />
          <button type="button" disabled={saving} onClick={() => void savePreset()} style={buttonStyle("secondary")}>
            Сохранить текущий workflow
          </button>
        </div>

        {presets.length > 0 && (
          <div style={{ display: "grid", gap: 6 }}>
            {presets.map((preset) => (
              <div key={preset.name} style={{ display: "grid", gridTemplateColumns: "1fr auto", gap: 8, alignItems: "center", padding: "8px 0", borderBottom: "1px solid #1d212b" }}>
                <div>
                  <div style={{ fontWeight: 600 }}>{preset.name}</div>
                  <div style={{ marginTop: 3, fontSize: 10, opacity: 0.45 }}>
                    {preset.event} · {preset.conditions.length} ALL + {preset.anyConditions.length} ANY · {preset.actions.length} actions
                  </div>
                </div>
                <div style={{ display: "flex", gap: 6 }}>
                  <button type="button" disabled={saving} onClick={() => loadPreset(preset)} style={buttonStyle("secondary")}>Загрузить</button>
                  <button type="button" disabled={saving} onClick={() => void removePreset(preset.name)} style={buttonStyle("danger")}>Удалить</button>
                </div>
              </div>
            ))}
          </div>
        )}
      </section>

      <section style={sectionStyle}>
        <div style={sectionTitle}>Reusable templates</div>
        <div style={{ display: "grid", gridTemplateColumns: "minmax(130px,.4fr) minmax(0,1fr) auto", gap: 8 }}>
          <input value={templateName} maxLength={40} onChange={(e) => setTemplateName(e.target.value)} placeholder="welcome" style={inputStyle} />
          <input value={templateContent} maxLength={2000} onChange={(e) => setTemplateContent(e.target.value)} placeholder="Привет, {user}! Канал: {channel}" style={inputStyle} />
          <button type="button" disabled={saving || !templateName.trim() || !templateContent.trim()} onClick={() => void (async () => {
            const response = await fetch("/api/guilds/" + encodeURIComponent(guildId) + "/automation/templates", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ name: templateName, content: templateContent }) });
            const body = await response.json().catch(() => ({}));
            if (!response.ok) { setError(body.error ?? "template_save_failed"); return; }
            setTemplateName(""); setTemplateContent(""); await load(); await onChanged?.();
          })()} style={buttonStyle("secondary")}>Сохранить</button>
        </div>
        {templates.length ? templates.map((template) => (
          <div key={template.name} style={{ display: "flex", justifyContent: "space-between", gap: 8, alignItems: "center", padding: "8px 9px", borderRadius: 9, background: "#0c1118", border: "1px solid #1d2430" }}>
            <div style={{ minWidth: 0 }}><strong style={{ fontSize: 10 }}>{template.name}</strong><div style={{ marginTop: 2, color: "#697486", fontSize: 9, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>{template.content}</div></div>
            <div style={{ display: "flex", gap: 5 }}>
              <button type="button" disabled={saving} onClick={() => { setTemplateName(template.name); setTemplateContent(template.content); }} style={buttonStyle("secondary")}>Править</button>
              <button type="button" disabled={saving} onClick={() => void (async () => {
                if (!window.confirm("Удалить шаблон " + template.name + "?")) return;
                const response = await fetch("/api/guilds/" + encodeURIComponent(guildId) + "/automation/templates/" + encodeURIComponent(template.name), { method: "DELETE" });
                if (!response.ok) { setError("Не удалось удалить шаблон."); return; }
                await load(); await onChanged?.();
              })()} style={buttonStyle("secondary")}>Удалить</button>
            </div>
          </div>
        )) : <div style={{ opacity: 0.4, fontSize: 11 }}>Шаблонов пока нет.</div>}
        <div style={{ opacity: 0.4, fontSize: 10 }}>В действиях используй <code>{"{template:name}"}</code> и переменные события: <code>{"{user}"}</code>, <code>{"{channel}"}</code>, <code>{"{content}"}</code>, <code>{"{event}"}</code>.</div>
      </section>

      <input value={name} maxLength={80} onChange={(e) => setName(e.target.value)} placeholder="Название правила" style={inputStyle} />

      <div style={{ display: "grid", gridTemplateColumns: "minmax(0,2fr) minmax(120px,1fr) auto", gap: 8 }}>
        <select value={event} onChange={(e) => setEvent(e.target.value)} style={inputStyle}>
          {EVENTS.map((item) => <option key={item}>{item}</option>)}
        </select>
        <input type="number" min={0} max={86400} value={cooldownSeconds} onChange={(e) => setCooldownSeconds(Number(e.target.value))} style={inputStyle} />
        <button type="button" onClick={() => setEnabled((value) => !value)} style={buttonStyle("secondary")}>{enabled ? "ON" : "OFF"}</button>
      </div>

      <section style={sectionStyle}>
        <div style={sectionTitle}>Conditions · ALL</div>
        {conditions.length === 0 && <div style={{ opacity: 0.4, fontSize: 12 }}>Без условий — правило реагирует на каждый выбранный event.</div>}
        {conditions.map((condition, index) => (
          <div key={index} style={rowStyle}>
            <select value={condition.type} onChange={(e) => replaceCondition(index, e.target.value as Condition["type"])} style={inputStyle}>
              <option value="contains">contains</option>
              <option value="equals">equals</option>
              <option value="matches">matches</option>
              <option value="number-gte">number-gte</option>
              <option value="number-lte">number-lte</option>
              <option value="has-role">has-role</option>
              <option value="not-has-role">not-has-role</option>
              <option value="channel-is">channel-is</option>
              <option value="channel-type-is">channel-type-is</option>
              <option value="user-is-bot">user-is-bot</option>
              <option value="has-permission">has-permission</option>
              <option value="cooldown-clear">cooldown-clear</option>
            </select>

            {(condition.type === "contains" || condition.type === "equals" || condition.type === "matches") && (
              <>
                <select value={condition.left} onChange={(e) => updateCondition(index, { left: e.target.value })} style={inputStyle}>
                  {TEXT_FIELDS.map((field) => <option key={field}>{field}</option>)}
                </select>
                <input
                  value={condition.type === "matches" ? condition.pattern : condition.right}
                  maxLength={condition.type === "matches" ? 120 : 200}
                  onChange={(e) => updateCondition(index, condition.type === "matches" ? { pattern: e.target.value } : { right: e.target.value })}
                  placeholder={condition.type === "matches" ? "Regex" : "Значение"}
                  style={inputStyle}
                />
              </>
            )}

            {(condition.type === "number-gte" || condition.type === "number-lte") && (
              <>
                <select value={condition.left} onChange={(e) => updateCondition(index, { left: e.target.value })} style={inputStyle}>
                  {NUMBER_FIELDS.map((field) => <option key={field}>{field}</option>)}
                </select>
                <input type="number" value={condition.right} onChange={(e) => updateCondition(index, { right: Number(e.target.value) })} style={inputStyle} />
              </>
            )}

            {(condition.type === "has-role" || condition.type === "not-has-role") && (
              <>
                <input value={condition.userId} onChange={(e) => updateCondition(index, { userId: e.target.value })} placeholder="@event или user ID" style={inputStyle} />
                <select value={condition.roleId} onChange={(e) => updateCondition(index, { roleId: e.target.value })} style={inputStyle}>
                  <option value="">Роль</option>
                  {roles.map((role) => <option key={role.id} value={role.id}>{role.name}</option>)}
                </select>
              </>
            )}

            {condition.type === "channel-is" && (
              <select value={condition.channelId} onChange={(e) => updateCondition(index, { channelId: e.target.value })} style={inputStyle}>
                <option value="">Канал</option>
                {channels.map((channel) => <option key={channel.id} value={channel.id}>{channel.name}</option>)}
              </select>
            )}

            {condition.type === "channel-type-is" && (
              <select value={condition.channelType} onChange={(e) => updateCondition(index, { channelType: e.target.value as AutomationChannelType })} style={inputStyle}>
                {CHANNEL_TYPES.map((type) => <option key={type} value={type}>{type}</option>)}
              </select>
            )}

            {condition.type === "user-is-bot" && (
              <>
                <input value={condition.userId} onChange={(e) => updateCondition(index, { userId: e.target.value })} placeholder="@event или user ID" style={inputStyle} />
                <select value={String(condition.value)} onChange={(e) => updateCondition(index, { value: e.target.value === "true" })} style={inputStyle}>
                  <option value="true">bot = true</option>
                  <option value="false">bot = false</option>
                </select>
              </>
            )}

            {condition.type === "has-permission" && (
              <>
                <input value={condition.userId} onChange={(e) => updateCondition(index, { userId: e.target.value })} placeholder="@event или user ID" style={inputStyle} />
                <select value={condition.permission} onChange={(e) => updateCondition(index, { permission: e.target.value as AutomationPermission })} style={inputStyle}>
                  {PERMISSIONS.map((permission) => <option key={permission} value={permission}>{permission}</option>)}
                </select>
              </>
            )}

            {condition.type === "cooldown-clear" && (
              <input value={condition.key} maxLength={100} onChange={(e) => updateCondition(index, { key: e.target.value })} placeholder="Имя cooldown key" style={inputStyle} />
            )}

            <button type="button" onClick={() => setConditions((current) => current.filter((_, i) => i !== index))} style={buttonStyle("secondary")}>×</button>
          </div>
        ))}
        <button type="button" disabled={saving || conditions.length >= 10} onClick={() => setConditions((current) => [...current, { type: "contains", left: "content", right: "" }])} style={buttonStyle("secondary")}>+ Условие</button>
      </section>

      <section style={sectionStyle}>
        <div style={sectionTitle}>Conditions · ANY</div>
        {anyConditions.length === 0 && <div style={{ opacity: 0.4, fontSize: 12 }}>Нет OR-условий. Заполни их, если достаточно любого совпадения.</div>}
        {anyConditions.map((condition, index) => (
          <div key={"any-" + index} style={rowStyle}>
            <select value={condition.type} onChange={(e) => replaceCondition(index, e.target.value as Condition["type"], true)} style={inputStyle}>
              <option value="contains">contains</option>
              <option value="equals">equals</option>
              <option value="matches">matches</option>
              <option value="number-gte">number-gte</option>
              <option value="number-lte">number-lte</option>
              <option value="has-role">has-role</option>
              <option value="channel-is">channel-is</option>
              <option value="cooldown-clear">cooldown-clear</option>
            </select>

            {(condition.type === "contains" || condition.type === "equals" || condition.type === "matches") && (
              <>
                <select value={condition.left} onChange={(e) => updateCondition(index, { left: e.target.value }, true)} style={inputStyle}>
                  {TEXT_FIELDS.map((field) => <option key={field}>{field}</option>)}
                </select>
                <input
                  value={condition.type === "matches" ? condition.pattern : condition.right}
                  maxLength={condition.type === "matches" ? 120 : 200}
                  onChange={(e) => updateCondition(index, condition.type === "matches" ? { pattern: e.target.value } : { right: e.target.value }, true)}
                  placeholder={condition.type === "matches" ? "Regex" : "Значение"}
                  style={inputStyle}
                />
              </>
            )}

            {(condition.type === "number-gte" || condition.type === "number-lte") && (
              <>
                <select value={condition.left} onChange={(e) => updateCondition(index, { left: e.target.value }, true)} style={inputStyle}>
                  {NUMBER_FIELDS.map((field) => <option key={field}>{field}</option>)}
                </select>
                <input type="number" value={condition.right} onChange={(e) => updateCondition(index, { right: Number(e.target.value) }, true)} style={inputStyle} />
              </>
            )}

            {condition.type === "has-role" && (
              <>
                <input value={condition.userId} onChange={(e) => updateCondition(index, { userId: e.target.value }, true)} placeholder="@event или user ID" style={inputStyle} />
                <select value={condition.roleId} onChange={(e) => updateCondition(index, { roleId: e.target.value }, true)} style={inputStyle}>
                  <option value="">Роль</option>
                  {roles.map((role) => <option key={role.id} value={role.id}>{role.name}</option>)}
                </select>
              </>
            )}

            {condition.type === "channel-is" && (
              <select value={condition.channelId} onChange={(e) => updateCondition(index, { channelId: e.target.value }, true)} style={inputStyle}>
                <option value="">Канал</option>
                {channels.map((channel) => <option key={channel.id} value={channel.id}>{channel.name}</option>)}
              </select>
            )}

            {condition.type === "cooldown-clear" && (
              <input value={condition.key} maxLength={100} onChange={(e) => updateCondition(index, { key: e.target.value }, true)} placeholder="Имя cooldown key" style={inputStyle} />
            )}

            <button type="button" onClick={() => setAnyConditions((current) => current.filter((_, i) => i !== index))} style={buttonStyle("secondary")}>×</button>
          </div>
        ))}
        <button
          type="button"
          disabled={saving || conditions.length + anyConditions.length >= 10}
          onClick={() => setAnyConditions((current) => [...current, { type: "contains", left: "content", right: "" }])}
          style={buttonStyle("secondary")}
        >
          + OR-условие
        </button>
      </section>

      <section style={sectionStyle}>
        <div style={sectionTitle}>Actions</div>
        {actions.map((action, index) => (
          <div key={index} style={{ display: "grid", gridTemplateColumns: "minmax(150px,180px) minmax(0,1fr) auto", gap: 8 }}>
            <select value={action.type} onChange={(e) => replaceAction(index, e.target.value as Action["type"])} style={inputStyle}>
              <option value="send-message">send-message</option>
              <option value="dm-user">dm-user</option>
              <option value="add-role">add-role</option>
              <option value="remove-role">remove-role</option>
              <option value="timeout">timeout</option>
              <option value="warn">warn</option>
              <option value="kick">kick</option>
              <option value="ban">ban</option>
              <option value="delete-message">delete-message</option>
              <option value="set-nickname">set-nickname</option>
              <option value="react-message">react-message</option>
              <option value="log">log</option>
              <option value="delay">delay</option>
              <option value="webhook">webhook</option>
              <option value="branch">branch</option>
            </select>

            {action.type === "send-message" && (
              <div style={actionGrid}>
                <select value={action.channelId} onChange={(e) => updateAction(index, { channelId: e.target.value })} style={inputStyle}>
                  <option value="">Канал</option>
                  {channels.map((channel) => <option key={channel.id} value={channel.id}>{channel.name}</option>)}
                </select>
                <input value={action.content} maxLength={2000} onChange={(e) => updateAction(index, { content: e.target.value })} placeholder="Текст · {user} {channel} {content}" style={inputStyle} />
              </div>
            )}

            {action.type === "dm-user" && (
              <div style={actionGrid}>
                <input value={action.userId} onChange={(e) => updateAction(index, { userId: e.target.value })} placeholder="@event или user ID" style={inputStyle} />
                <input value={action.content} maxLength={2000} onChange={(e) => updateAction(index, { content: e.target.value })} placeholder="Личное сообщение" style={inputStyle} />
              </div>
            )}

            {(action.type === "add-role" || action.type === "remove-role") && (
              <div style={actionGrid}>
                <input value={action.userId} onChange={(e) => updateAction(index, { userId: e.target.value })} placeholder="@event или user ID" style={inputStyle} />
                <select value={action.roleId} onChange={(e) => updateAction(index, { roleId: e.target.value })} style={inputStyle}>
                  <option value="">Роль</option>
                  {roles.map((role) => <option key={role.id} value={role.id}>{role.name}</option>)}
                </select>
              </div>
            )}

            {action.type === "timeout" && (
              <div style={actionGrid}>
                <input value={action.userId} onChange={(e) => updateAction(index, { userId: e.target.value })} placeholder="@event или user ID" style={inputStyle} />
                <input type="number" min={1} max={2419200} value={action.durationSeconds} onChange={(e) => updateAction(index, { durationSeconds: Number(e.target.value) })} style={inputStyle} />
                <input value={action.reason} maxLength={500} onChange={(e) => updateAction(index, { reason: e.target.value })} placeholder="Причина" style={inputStyle} />
              </div>
            )}

            {(action.type === "warn" || action.type === "kick") && (
              <div style={actionGrid}>
                <input value={action.userId} onChange={(e) => updateAction(index, { userId: e.target.value })} placeholder="@event или user ID" style={inputStyle} />
                <input value={action.reason} maxLength={500} onChange={(e) => updateAction(index, { reason: e.target.value })} placeholder="Причина" style={inputStyle} />
              </div>
            )}

            {action.type === "ban" && (
              <div style={actionGrid}>
                <input value={action.userId} onChange={(e) => updateAction(index, { userId: e.target.value })} placeholder="@event или user ID" style={inputStyle} />
                <input type="number" min={1} max={40320} value={action.durationMinutes ?? ""} onChange={(e) => updateAction(index, { durationMinutes: e.target.value ? Number(e.target.value) : undefined })} placeholder="Срок (мин), пусто = навсегда" style={inputStyle} />
                <input value={action.reason} maxLength={500} onChange={(e) => updateAction(index, { reason: e.target.value })} placeholder="Причина" style={inputStyle} />
              </div>
            )}

            {action.type === "set-nickname" && (
              <div style={actionGrid}>
                <input value={action.userId} onChange={(e) => updateAction(index, { userId: e.target.value })} placeholder="@event или user ID" style={inputStyle} />
                <input value={action.nickname ?? ""} maxLength={32} onChange={(e) => updateAction(index, { nickname: e.target.value || null })} placeholder="Никнейм; пусто = сброс" style={inputStyle} />
              </div>
            )}

            {action.type === "react-message" && (
              <div style={actionGrid}>
                <select value={action.channelId} onChange={(e) => updateAction(index, { channelId: e.target.value })} style={inputStyle}>
                  <option value="@event">@event channel</option>
                  {channels.map((channel) => <option key={channel.id} value={channel.id}>{channel.name}</option>)}
                </select>
                <input value={action.messageId} onChange={(e) => updateAction(index, { messageId: e.target.value })} placeholder="@event или message ID" style={inputStyle} />
                <input value={action.emoji} maxLength={100} onChange={(e) => updateAction(index, { emoji: e.target.value })} placeholder="👍 или <:emoji:id>" style={inputStyle} />
              </div>
            )}

            {action.type === "delete-message" && (
              <div style={actionGrid}>
                <input value={action.channelId} onChange={(e) => updateAction(index, { channelId: e.target.value })} placeholder="@event или channel ID" style={inputStyle} />
                <input value={action.messageId} onChange={(e) => updateAction(index, { messageId: e.target.value })} placeholder="@event или message ID" style={inputStyle} />
              </div>
            )}

            {action.type === "log" && (
              <input value={action.message} maxLength={1000} onChange={(e) => updateAction(index, { message: e.target.value })} placeholder="Audit log message" style={inputStyle} />
            )}

            {action.type === "delay" && (
              <input type="number" min={1} max={3600} value={action.seconds} onChange={(e) => updateAction(index, { seconds: Number(e.target.value) })} placeholder="Seconds" style={inputStyle} />
            )}

            {action.type === "webhook" && (
              <div style={actionGrid}>
                <input value={action.url} onChange={(e) => updateAction(index, { url: e.target.value })} placeholder="https://example.com/webhook" style={inputStyle} />
                <input value={action.content} maxLength={2000} onChange={(e) => updateAction(index, { content: e.target.value })} placeholder="Webhook content · {user} {channel} {content}" style={inputStyle} />
              </div>
            )}

            {action.type === "branch" && (
              <div style={{ display: "grid", gap: 8 }}>
                <textarea
                  value={JSON.stringify({ condition: action.condition, thenActions: action.thenActions, elseActions: action.elseActions }, null, 2)}
                  onChange={(e) => {
                    try {
                      const parsed = JSON.parse(e.target.value) as { condition: Condition; thenActions: Action[]; elseActions?: Action[] };
                      if (!parsed.condition || !Array.isArray(parsed.thenActions) || (parsed.elseActions !== undefined && !Array.isArray(parsed.elseActions))) return;
                      updateAction(index, { condition: parsed.condition, thenActions: parsed.thenActions, elseActions: parsed.elseActions ?? [] });
                    } catch {
                      // Keep the last valid branch until JSON is complete.
                    }
                  }}
                  rows={9}
                  spellCheck={false}
                  style={{ ...inputStyle, fontFamily: "monospace", resize: "vertical" }}
                  aria-label="Conditional branch JSON"
                />
                <div style={{ fontSize: 11, opacity: 0.45 }}>
                  Branch: JSON с полями condition, thenActions и необязательным elseActions. Вложенность до 2 уровней, максимум 10 действий на ветку.
                </div>
              </div>
            )}

            <button type="button" disabled={saving || actions.length === 1} onClick={() => setActions((current) => current.filter((_, i) => i !== index))} style={buttonStyle("secondary")}>×</button>
          </div>
        ))}
        <button type="button" disabled={saving || actions.length >= 10} onClick={() => setActions((current) => [...current, { type: "log", message: "" }])} style={buttonStyle("secondary")}>+ Действие</button>
      </section>

      {diagnostics && (
        <section style={sectionStyle}>
          <div style={{ display: "flex", justifyContent: "space-between", gap: 8, alignItems: "center" }}>
            <div>
              <div style={sectionTitle}>Diagnostics · Automation</div>
              <div style={{ marginTop: 4, fontSize: 11, opacity: 0.5 }}>Состояние правил, cooldown-кэша и отложенных задач. Содержимое событий и actions здесь не показывается.</div>
            </div>
            <button
              type="button"
              disabled={saving || dryRunBusy}
              onClick={() => void load().catch(() => setError("Не удалось обновить diagnostics."))}
              style={buttonStyle("secondary")}
            >
              Обновить
            </button>
          </div>

          <div style={{ display: "grid", gridTemplateColumns: "repeat(5,minmax(0,1fr))", gap: 8 }}>
            <Metric label="Rules" value={String(diagnostics.rules.enabled) + " / " + diagnostics.rules.total} />
            <Metric label="Templates" value={String(diagnostics.templates.total)} />
            <Metric label="Delayed pending" value={String(diagnostics.delayedJobs.pending)} />
            <Metric label="Errors" value={String(diagnostics.delayedJobs.withErrors)} />
            <Metric label="Dead letter" value={String(diagnostics.delayedJobs.deadLettered)} />
          </div>

          <div style={{ display: "grid", gridTemplateColumns: "repeat(3,minmax(0,1fr))", gap: 8 }}>
            <Metric label="Processing" value={String(diagnostics.delayedJobs.processing)} />
            <Metric label="Done · 24h" value={String(diagnostics.delayedJobs.completed24h)} />
            <Metric label="Loaded rules" value={String(diagnostics.runtime.loadedRules)} />
          </div>

          {diagnostics.delayedJobs.oldestPendingAt && (
            <div style={{ fontSize: 10, opacity: 0.5 }}>
              Самая старая незавершённая задача: {new Date(diagnostics.delayedJobs.oldestPendingAt).toLocaleString()}
            </div>
          )}

          {diagnostics.delayedJobs.recent.length > 0 && (
            <div style={{ display: "grid", gap: 5 }}>
              {diagnostics.delayedJobs.recent.map((job) => (
                <div key={job.id} style={{ display: "grid", gridTemplateColumns: "90px 90px 1fr 80px", gap: 8, alignItems: "center", padding: "7px 8px", borderRadius: 8, background: "#0b1016", border: "1px solid #1c222d", fontSize: 10 }}>
                  <strong>{job.status}</strong>
                  <span style={{ opacity: 0.55 }}>#{job.id}</span>
                  <span style={{ opacity: 0.55, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>{job.lastError || ("available " + new Date(job.availableAt).toLocaleString())}</span>
                  <span style={{ opacity: 0.55, textAlign: "right" }}>attempts: {job.attempts}</span>
                </div>
              ))}
            </div>
          )}
        </section>
      )}

      <section style={sectionStyle}>
        <div style={sectionTitle}>Dry run · безопасная проверка</div>
        <div style={{ fontSize: 11, opacity: 0.5 }}>Не выполняет Discord-действия и не вызывает webhook. Проверяет текущее несохранённое правило и показывает ожидаемый результат.</div>
        <div style={{ display: "grid", gridTemplateColumns: "minmax(0,2fr) minmax(160px,1fr)", gap: 8 }}>
          <input value={testContent} maxLength={2000} onChange={(e) => setTestContent(e.target.value)} placeholder="Содержимое события" style={inputStyle} />
          <select value={testChannelId} onChange={(e) => setTestChannelId(e.target.value)} style={inputStyle}>
            <option value="">Канал события</option>
            {channels.map((channel) => <option key={channel.id} value={channel.id}>{channel.name}</option>)}
          </select>
          <input value={testUserId} onChange={(e) => setTestUserId(e.target.value)} placeholder="User ID события" style={inputStyle} />
          <select value={String(testUserIsBot)} onChange={(e) => setTestUserIsBot(e.target.value === "true")} style={inputStyle}>
            <option value="false">event user = member</option>
            <option value="true">event user = bot</option>
          </select>
          <select value={testChannelType} onChange={(e) => setTestChannelType(e.target.value as AutomationChannelType)} style={inputStyle}>
            {CHANNEL_TYPES.map((type) => <option key={type} value={type}>channel type: {type}</option>)}
          </select>
          <input value={testRoleIds} onChange={(e) => setTestRoleIds(e.target.value)} placeholder="Role IDs через запятую" style={inputStyle} />
          <input value={testPermissions} onChange={(e) => setTestPermissions(e.target.value)} placeholder="Permissions через запятую" style={inputStyle} />
          <input value={testNumeric} onChange={(e) => setTestNumeric(e.target.value)} placeholder='Числовые поля JSON, например {"caseId":1}' style={inputStyle} />
        </div>
        <button type="button" disabled={saving || dryRunBusy || actions.length === 0} onClick={() => void (async () => {
          setDryRunBusy(true);
          setError("");
          try {
            let numeric: Record<string, number> = {};
            try {
              const parsed = JSON.parse(testNumeric) as Record<string, unknown>;
              if (!parsed || Array.isArray(parsed) || typeof parsed !== "object") throw new Error();
              numeric = Object.fromEntries(Object.entries(parsed).filter(([, value]) => typeof value === "number" && Number.isFinite(value))) as Record<string, number>;
            } catch {
              throw new Error("Числовые поля должны быть валидным JSON-объектом.");
            }
            const response = await fetch("/api/guilds/" + encodeURIComponent(guildId) + "/automation/dry-run", {
              method: "POST",
              headers: { "content-type": "application/json" },
              body: JSON.stringify({
                event,
                conditions,
                anyConditions,
                actions,
                cooldownSeconds,
                content: testContent,
                userId: testUserId || undefined,
                channelId: testChannelId || undefined,
                channelType: testChannelType,
                userIsBot: testUserIsBot,
                roleIds: testRoleIds.split(",").map((value) => value.trim()).filter(Boolean),
                permissions: testPermissions.split(",").map((value) => value.trim()).filter(Boolean),
                numeric
              })
            });
            const body = await response.json().catch(() => ({}));
            if (!response.ok) throw new Error(body.error ?? "automation_dry_run_failed");
            setDryRunResult(body.result ?? null);
          } catch (caught) {
            setDryRunResult(null);
            setError(caught instanceof Error ? caught.message : "Dry run не выполнен.");
          } finally {
            setDryRunBusy(false);
          }
        })()} style={buttonStyle("secondary")}>{dryRunBusy ? "Проверка…" : "▶ Тестировать правило"}</button>
        {dryRunResult && (
          <div style={{ padding: 10, borderRadius: 9, border: "1px solid " + (dryRunResult.matched ? "#315c41" : "#513a3a"), background: "#0b1117" }}>
            <strong>{dryRunResult.matched ? "Условия совпали" : "Условия не совпали"}</strong>
            {dryRunResult.matched && dryRunResult.renderedActions.length > 0 && (
              <div style={{ marginTop: 7, display: "grid", gap: 4 }}>
                {dryRunResult.renderedActions.map((item, index) => <div key={item.type + index} style={{ fontSize: 10, opacity: 0.75 }}><code>{item.type}</code> · {item.preview}</div>)}
              </div>
            )}
          </div>
        )}
      </section>

      <div style={{ display: "flex", gap: 8 }}>
        <button type="button" disabled={saving} onClick={() => void save()} style={buttonStyle("primary")}>{editingId ? "Сохранить изменения" : "Создать rule"}</button>
        {editingId && <button type="button" disabled={saving} onClick={reset} style={buttonStyle("secondary")}>Отмена</button>}
      </div>

      <section style={sectionStyle}>
        <div style={sectionTitle}>Rules</div>
        {rules.length === 0 ? <div style={{ opacity: 0.42 }}>Правил пока нет.</div> : rules.map((rule) => (
          <div key={rule.id} style={{ display: "flex", justifyContent: "space-between", gap: 12, padding: "10px 0", borderBottom: "1px solid #1d212b" }}>
            <div>
              <div style={{ fontWeight: 600 }}>{rule.name} · {rule.enabled ? "ON" : "OFF"}</div>
              <div style={{ marginTop: 4, fontSize: 11, opacity: 0.45 }}>{rule.event} · {rule.all.length} ALL + {rule.any.length} ANY · {rule.actions.length} actions</div>
            </div>
            <div style={{ display: "flex", gap: 6 }}>
              <button type="button" disabled={saving} onClick={() => edit(rule)} style={buttonStyle("secondary")}>Изменить</button>
              <button type="button" disabled={saving} onClick={() => void remove(rule.id)} style={buttonStyle("danger")}>Удалить</button>
            </div>
          </div>
        ))}
      </section>
    </div>
  );
}

const inputStyle = {
  background: "#0d1016",
  color: "#f4f5f7",
  border: "1px solid #303643",
  borderRadius: 9,
  padding: "9px 10px",
  width: "100%",
  boxSizing: "border-box" as const
};

const rowStyle = {
  display: "grid",
  gridTemplateColumns: "minmax(150px,180px) minmax(0,1fr) minmax(0,1fr) auto",
  gap: 8,
  alignItems: "center"
} as const;

const actionGrid = {
  display: "grid",
  gridTemplateColumns: "minmax(0,1fr) minmax(0,1fr) minmax(0,1fr)",
  gap: 8
} as const;

const sectionStyle = {
  display: "grid",
  gap: 9,
  padding: 13,
  border: "1px solid #202530",
  borderRadius: 12,
  background: "#0e1117"
} as const;

function Metric({ label, value }: { label: string; value: string }) {
  return (
    <div style={{ padding: "9px 10px", borderRadius: 9, background: "#0b1016", border: "1px solid #1c222d" }}>
      <div style={{ fontSize: 9, opacity: 0.42, textTransform: "uppercase", letterSpacing: 0.7 }}>{label}</div>
      <div style={{ marginTop: 3, fontSize: 16, fontWeight: 700 }}>{value}</div>
    </div>
  );
}

const sectionTitle = {
  fontSize: 12,
  opacity: 0.55,
  textTransform: "uppercase" as const,
  letterSpacing: 1
};

function buttonStyle(kind: "primary" | "secondary" | "danger") {
  return {
    border: "1px solid " + (kind === "primary" ? "#5865f2" : kind === "danger" ? "#79343c" : "#303643"),
    background: kind === "primary" ? "#5865f2" : kind === "danger" ? "#4b2227" : "#171a21",
    color: "#fff",
    borderRadius: 9,
    padding: "9px 12px",
    cursor: "pointer"
  } as const;
}
