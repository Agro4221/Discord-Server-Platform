import crypto from "node:crypto";
import type { Express, Request, Response, NextFunction } from "express";
import {
  ChannelType,
  type Client,
  type Guild,
  type GuildBasedChannel
} from "discord.js";
import { config } from "./config.js";
import { Store, type StreamSource } from "./db.js";
import { escapeHtml } from "./format.js";
import type { AnnouncementService } from "./announcements.js";

const ADMIN_BUILD = "2026-09-20-no-js-admin";

function checkBasicAuth(request: Request): boolean {
  const header = request.headers.authorization;
  if (!header?.startsWith("Basic ")) return false;

  try {
    const decoded = Buffer.from(header.slice(6), "base64").toString("utf8");
    const separator = decoded.indexOf(":");
    if (separator < 0) return false;

    const username = decoded.slice(0, separator);
    const password = decoded.slice(separator + 1);

    const expectedUsername = Buffer.from(config.adminUsername);
    const actualUsername = Buffer.from(username);

    if (
      actualUsername.length !== expectedUsername.length ||
      !crypto.timingSafeEqual(actualUsername, expectedUsername)
    ) {
      return false;
    }

    const a = Buffer.from(password);
    const b = Buffer.from(config.adminPassword);

    return a.length === b.length && crypto.timingSafeEqual(a, b);
  } catch {
    return false;
  }
}

function auth(
  request: Request,
  response: Response,
  next: NextFunction
): void {
  if (checkBasicAuth(request)) {
    next();
    return;
  }

  response.setHeader(
    "WWW-Authenticate",
    'Basic realm="Stream Bot Admin"'
  );
  response.status(401).send("Authentication required");
}

function page(title: string, body: string): string {
  return [
    "<!doctype html>",
    '<html lang="ru">',
    "<head>",
    '<meta charset="utf-8">',
    '<meta name="viewport" content="width=device-width,initial-scale=1">',
    "<title>" + escapeHtml(title) + "</title>",
    "<style>",
    "body{font-family:system-ui,-apple-system,Segoe UI,sans-serif;max-width:1150px;margin:30px auto;padding:0 18px;background:#111827;color:#e5e7eb}",
    "h1,h2,h3{color:#fff}",
    "section{background:#1f2937;border:1px solid #374151;border-radius:12px;padding:18px;margin:16px 0}",
    "label{display:block;margin:9px 0 4px;color:#cbd5e1}",
    "input,select,textarea{width:100%;box-sizing:border-box;padding:10px;border-radius:8px;border:1px solid #4b5563;background:#111827;color:#fff}",
    "button{margin-top:10px;padding:9px 14px;border:0;border-radius:8px;cursor:pointer}",
    ".danger{background:#7f1d1d;color:#fff}.secondary{background:#374151;color:#fff}.ok{background:#065f46;color:#fff}",
    "table{width:100%;border-collapse:collapse}th,td{border-bottom:1px solid #374151;padding:8px;text-align:left;vertical-align:top}",
    "small,.muted{color:#9ca3af}.row{display:grid;grid-template-columns:1fr 1fr;gap:12px}",
    ".saved{background:#111827;border:1px solid #374151;border-radius:10px;padding:12px;margin:12px 0}",
    ".toolbar{display:flex;gap:8px;align-items:center;flex-wrap:wrap}.toolbar form{display:inline}",
    "details{background:#111827;border:1px solid #374151;border-radius:10px;padding:12px;margin:12px 0}",
    "summary{cursor:pointer;font-weight:700;color:#fff}",
    ".toast{position:fixed;left:50%;bottom:20px;transform:translateX(-50%);z-index:1000;background:#065f46;color:#fff;border:1px solid #34d399;border-radius:10px;padding:12px 18px;box-shadow:0 8px 30px rgba(0,0,0,.35);animation:toastHide 5s ease forwards}",
    ".toast.error{background:#7f1d1d;border-color:#f87171}",
    "@keyframes toastHide{0%,80%{opacity:1}100%{opacity:0;visibility:hidden}}",
    "footer{color:#6b7280;font-size:12px;margin:16px 0}",
    "@media(max-width:700px){.row{grid-template-columns:1fr}}",
    "code{background:#111827;padding:2px 5px;border-radius:5px}",
    "</style>",
    "</head>",
    "<body>" + body + "</body>",
    "</html>"
  ].join("\n");
}

function defaultTemplate(): string {
  return "Хей! {channel} запустил стрим на канале. Присоединяйся!\\n{url}";
}

function required(value: unknown, name: string): string {
  const result = String(value ?? "").trim();

  if (!result) {
    throw new Error("Поле " + name + " обязательно.");
  }

  if (result.length > 1000) {
    throw new Error("Поле " + name + " слишком длинное.");
  }

  return result;
}

function getGuildView(guild: Guild) {
  const channels = [...guild.channels.cache.values()];

  return {
    id: guild.id,
    name: guild.name,
    textChannels: channels
      .filter(
        (channel) =>
          channel.type === ChannelType.GuildText ||
          channel.type === ChannelType.GuildAnnouncement
      )
      .sort((a, b) => a.rawPosition - b.rawPosition || a.name.localeCompare(b.name))
      .map((channel) => ({
        id: channel.id,
        name: channel.name,
        type: channel.type
      })),
    voiceChannels: channels
      .filter((channel) => channel.type === ChannelType.GuildVoice)
      .sort((a, b) => a.rawPosition - b.rawPosition || a.name.localeCompare(b.name))
      .map((channel) => ({ id: channel.id, name: channel.name })),
    categories: channels
      .filter((channel) => channel.type === ChannelType.GuildCategory)
      .sort((a, b) => a.rawPosition - b.rawPosition || a.name.localeCompare(b.name))
      .map((channel) => ({ id: channel.id, name: channel.name }))
  };
}

function option(value: string, label: string, selected = false): string {
  return (
    '<option value="' +
    escapeHtml(value) +
    '"' +
    (selected ? " selected" : "") +
    ">" +
    escapeHtml(label) +
    "</option>"
  );
}

function guildOptions(
  guilds: ReturnType<typeof getGuildView>[],
  selectedId: string
): string {
  return [
    option("", "Выберите сервер", !selectedId),
    ...guilds.map((guild) => option(guild.id, guild.name, guild.id === selectedId))
  ].join("");
}

function allTextChannelOptions(
  guilds: ReturnType<typeof getGuildView>[],
  selectedId: string
): string {
  const groups = guilds.map((guild) => {
    const items = guild.textChannels
      .map((channel) =>
        option(
          channel.id,
          channel.type === ChannelType.GuildAnnouncement
            ? "📢 #" + channel.name
            : "#" + channel.name,
          channel.id === selectedId
        )
      )
      .join("");

    return '<optgroup label="' + escapeHtml(guild.name) + '">' + items + "</optgroup>";
  });

  return [option("", "Выберите Discord канал", !selectedId), ...groups].join("");
}

function allVoiceChannelOptions(
  guilds: ReturnType<typeof getGuildView>[],
  selectedId: string
): string {
  const groups = guilds.map((guild) => {
    const items = guild.voiceChannels
      .map((channel) => option(channel.id, "🔊 " + channel.name, channel.id === selectedId))
      .join("");

    return '<optgroup label="' + escapeHtml(guild.name) + '">' + items + "</optgroup>";
  });

  return [option("", "Выберите trigger-канал", !selectedId), ...groups].join("");
}

function allCategoryOptions(
  guilds: ReturnType<typeof getGuildView>[],
  selectedId: string
): string {
  const groups = guilds.map((guild) => {
    const items = guild.categories
      .map((channel) => option(channel.id, "📁 " + channel.name, channel.id === selectedId))
      .join("");

    return '<optgroup label="' + escapeHtml(guild.name) + '">' + items + "</optgroup>";
  });

  return [option("", "Без категории", !selectedId), ...groups].join("");
}

function channelDisplayName(client: Client, channelId: string): string {
  for (const guild of client.guilds.cache.values()) {
    const channel = guild.channels.cache.get(channelId);

    if (channel) {
      const prefix =
        channel.type === ChannelType.GuildVoice
          ? "🔊 "
          : channel.type === ChannelType.GuildCategory
            ? "📁 "
            : "#";

      return guild.name + " · " + prefix + channel.name;
    }
  }

  return "Канал не найден (" + channelId + ")";
}

function guildIdForChannel(client: Client, channelId: string): string | null {
  for (const guild of client.guilds.cache.values()) {
    if (guild.channels.cache.has(channelId)) return guild.id;
  }

  return null;
}

function channelBelongsToGuild(
  guild: Guild,
  channelId: string,
  allowed: ReadonlySet<number>
): GuildBasedChannel | null {
  const channel = guild.channels.cache.get(channelId);
  return channel && allowed.has(channel.type) ? channel : null;
}

function configuredGuildId(
  guilds: ReturnType<typeof getGuildView>[],
  predicate: (guild: ReturnType<typeof getGuildView>) => boolean
): string {
  return guilds.find(predicate)?.id ?? guilds[0]?.id ?? "";
}

function renderAdmin(
  store: Store,
  client: Client,
  request: Request,
  announcements?: AnnouncementService
): string {
  const guildEntities = [...client.guilds.cache.values()]
    .sort((a, b) => a.name.localeCompare(b.name));
  const guilds = guildEntities.map(getGuildView);
  const sources = store.listStreamSources();

  const savedSourceId = Number(request.query.savedSource);
  const savedSource = Number.isInteger(savedSourceId)
    ? sources.find((source) => source.id === savedSourceId) ?? null
    : null;

  const streamError = String(request.query.streamError ?? "").trim();
  const savedKind = String(request.query.saved ?? "");

  const draft = {
    provider: String(request.query.provider ?? ""),
    discordChannelId: String(request.query.discordChannelId ?? ""),
    displayName: String(request.query.displayName ?? ""),
    identifier: String(request.query.identifier ?? ""),
    template: String(request.query.template ?? "")
  };

  const voiceGuildId = configuredGuildId(
    guilds,
    (guild) => Boolean(store.getTempVoice(guild.id))
  );
  const voiceSettings = voiceGuildId ? store.getTempVoice(voiceGuildId) : null;

  const commandGuildId = configuredGuildId(
    guilds,
    (guild) => Boolean(store.getCommandChannel(guild.id))
  );
  const commandChannelId = commandGuildId
    ? store.getCommandChannel(commandGuildId) ?? ""
    : "";

  const streamEditors = sources.map((source) => {
    const sourceGuildId = guildIdForChannel(client, source.discordChannelId) ?? "";

    return (
      "<details" +
      (savedSource?.id === source.id ? " open" : "") +
      ">" +
      "<summary>" +
      escapeHtml(source.displayName) +
      " · " +
      escapeHtml(source.provider) +
      " · " +
      escapeHtml(channelDisplayName(client, source.discordChannelId)) +
      "</summary>" +
      '<form method="post" action="/streams/' +
      source.id +
      '">' +
      '<div class="row">' +
      "<div><label>Платформа</label><select name=\"provider\" required>" +
      option("twitch", "Twitch", source.provider === "twitch") +
      option("youtube", "YouTube", source.provider === "youtube") +
      option("vk", "VK Видео Live", source.provider === "vk") +
      "</select></div>" +
      "<div><label>Discord канал для уведомлений</label><select name=\"discordChannelId\" required>" +
      allTextChannelOptions(guilds, source.discordChannelId) +
      "</select></div>" +
      "</div>" +
      '<label>Отображаемое имя стримера</label>' +
      '<input name="displayName" value="' + escapeHtml(source.displayName) + '" required>' +
      '<label>Канал на платформе (логин или ссылка)</label>' +
      '<input name="identifier" value="' + escapeHtml(source.identifier) + '" required>' +
      "<label>Шаблон</label>" +
      '<textarea name="template" rows="3">' + escapeHtml(source.template) + "</textarea>" +
      '<button class="ok" type="submit">Сохранить источник</button>' +
      "</form>" +
      '<div class="toolbar">' +
      '<form method="post" action="/streams/' + source.id + '/toggle">' +
      '<button class="secondary" type="submit">' +
      (source.enabled ? "Выключить" : "Включить") +
      "</button></form>" +
      '<form method="post" action="/streams/' + source.id + '/delete">' +
      '<button class="danger" type="submit">Удалить</button></form>' +
      "</div>" +
      "</details>"
    );
  }).join("");

  const body = [
    "<h1>Stream Bot Admin</h1>",
    '<p class="muted">Админка без клиентского JavaScript: значения после сохранения берутся напрямую из SQLite.</p>',
    savedKind || savedSource || streamError
      ? '<div class="toast' + (streamError ? ' error' : '') + '" role="status">' +
        (streamError
          ? "Не удалось сохранить: " + escapeHtml(streamError)
          : savedSource
            ? "Источник сохранён · ID " + savedSource.id
            : savedKind === "voice"
              ? "Настройки временных комнат сохранены"
              : savedKind === "commands"
                ? "Канал команд сохранён"
                : "Настройки сохранены") +
        "</div>"
      : "",

    "<section>",
    "<h2>Временные голосовые комнаты</h2>",
    '<form method="post" action="/voice">',
    "<label>Discord сервер</label>",
    '<select name="guildId" required>' + guildOptions(guilds, voiceGuildId) + "</select>",
    "<label>Trigger-канал</label>",
    '<select name="triggerChannelId" required>' +
    allVoiceChannelOptions(guilds, voiceSettings?.triggerChannelId ?? "") +
    "</select>",
    "<label>Категория</label>",
    '<select name="categoryId">' +
    allCategoryOptions(guilds, voiceSettings?.categoryId ?? "") +
    "</select>",
    '<div class="row">',
    '<div><label>Лимит участников</label><input name="userLimit" type="number" min="0" max="99" value="' +
    escapeHtml(String(voiceSettings?.userLimit ?? 0)) +
    '"></div>',
    '<div><label>Приватные комнаты</label><select name="privateByDefault">' +
    option("0", "Нет", !voiceSettings?.privateByDefault) +
    option("1", "Да", Boolean(voiceSettings?.privateByDefault)) +
    "</select></div>",
    "</div>",
    '<button class="ok" type="submit">Сохранить</button>',
    "</form>",
    "</section>",

    "<section>",
    "<h2>Канал команд и музыка</h2>",
    '<form method="post" action="/commands">',
    "<label>Discord сервер</label>",
    '<select name="guildId" required>' + guildOptions(guilds, commandGuildId) + "</select>",
    "<label>Текстовый канал для команд</label>",
    '<select name="channelId" required>' +
    allTextChannelOptions(guilds, commandChannelId) +
    "</select>",
    '<button class="ok" type="submit">Сохранить канал команд</button>',
    '<div class="saved"><b>Музыка:</b> бот подключается к голосовому каналу пользователя, вызвавшего команду. Очередь после перезапуска не сохраняется.</div>',
    "<h3>Музыкальные команды</h3>",
    "<table><thead><tr><th>Действие</th><th>Slash</th><th>Восклицательный знак</th></tr></thead><tbody>" +
    "<tr><td>Добавить трек / плейлист</td><td><code>/play</code></td><td><code>!play Название или URL</code></td></tr>" +
    "<tr><td>Очередь</td><td><code>/queue</code></td><td><code>!queue</code></td></tr>" +
    "<tr><td>Следующий трек</td><td><code>/skip</code></td><td><code>!skip</code></td></tr>" +
    "<tr><td>Пауза</td><td><code>/pause</code></td><td><code>!pause</code></td></tr>" +
    "<tr><td>Продолжить</td><td><code>/resume</code></td><td><code>!resume</code></td></tr>" +
    "<tr><td>Остановить и очистить всё</td><td><code>/stop</code></td><td><code>!stop</code></td></tr>" +
    "<tr><td>Очистить только очередь</td><td><code>/clearqueue</code></td><td><code>!clearqueue</code></td></tr>" +
    "</tbody></table>",
    '<div class="saved"><b>После паузы:</b> <code>pause</code> замораживает текущий трек. <code>play</code> добавляет новый трек в очередь и не снимает паузу. Для продолжения используй <code>resume</code>.</div>',
    '<div class="saved"><b>Prefix:</b> ' +
    (config.commandPrefix
      ? "<code>" + escapeHtml(config.commandPrefix) + "</code>"
      : "не включён — добавь <code>COMMAND_PREFIX=! </code> в .env после включения Message Content Intent") +
    "</div>",
    '<div class="saved"><b>Временные комнаты:</b> при создании бот пытается установить 96 кбит/с. Discord применяет максимально разрешённый сервером битрейт, поэтому на сервере с меньшим лимитом останется доступное значение.</div>',
    "</form>",
    "</section>",

    "<section>",
    "<h2>Анонсы стримов</h2>",
    '<form method="post" action="/streams/add">',
    '<div class="row">',
    "<div><label>Платформа</label><select name=\"provider\" required>" +
    option("twitch", "Twitch", draft.provider !== "youtube" && draft.provider !== "vk") +
    option("youtube", "YouTube", draft.provider === "youtube") +
    option("vk", "VK Видео Live", draft.provider === "vk") +
    "</select></div>",
    "<div><label>Discord канал для уведомлений</label><select name=\"discordChannelId\" required>" +
    allTextChannelOptions(guilds, draft.discordChannelId || sources[0]?.discordChannelId || "") +
    "</select></div>",
    "</div>",
    '<label>Отображаемое имя стримера</label><input name="displayName" placeholder="Jostik" value="' +
    escapeHtml(draft.displayName) +
    '" required>',
    '<label>Канал на платформе (логин или ссылка)</label><input name="identifier" placeholder="https://www.twitch.tv/... или https://www.youtube.com/@..." value="' +
    escapeHtml(draft.identifier) +
    '" required>',
    "<label>Шаблон</label>",
    '<textarea name="template" rows="3">' +
    escapeHtml(draft.template || defaultTemplate()) +
    "</textarea>",
    '<button class="ok" type="submit">Добавить источник</button>',
    "</form>",
    sources.length
      ? "<h3>Сохранённые источники</h3>" + streamEditors
      : '<div class="saved">Сохранённых источников пока нет.</div>',
    '<form method="post" action="/streams/poll"><button class="secondary" type="submit">Проверить эфиры сейчас</button></form>',
    "</section>",

    "<section>",
    "<h2>Статус</h2>",
    "<p>Discord servers: <b>" + client.guilds.cache.size + "</b></p>",
    "<p>SQLite: сохранение настроек включено.</p>",
    "<footer>Admin build: " + ADMIN_BUILD + "</footer>",
    "</section>"
  ].join("\n");

  return page("Stream Bot Admin", body);
}

export function attachAdmin(
  app: Express,
  store: Store,
  client: Client,
  announcements?: AnnouncementService
): void {
  app.use(auth);

  app.get("/", (request, response) => {
    response.send(renderAdmin(store, client, request, announcements));
  });

  app.post("/commands", async (request, response) => {
    try {
      const guildId = required(request.body.guildId, "guildId");
      const channelId = required(request.body.channelId, "channelId");
      const guild = client.guilds.cache.get(guildId);

      if (!guild) throw new Error("Бот не находится на выбранном сервере.");

      if (!channelBelongsToGuild(
        guild,
        channelId,
        new Set([ChannelType.GuildText, ChannelType.GuildAnnouncement])
      )) {
        throw new Error("Канал команд не принадлежит выбранному серверу.");
      }

      store.setCommandChannel(guildId, channelId);
      response.redirect("/?saved=commands");
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
            response.status(400).send(page("Ошибка", '<h1>Ошибка</h1><p>' + escapeHtml(message) + '</p><p><a href="/">Назад</a></p>'));
    }
  });

  app.post("/voice", (request, response) => {
    try {
      const guildId = required(request.body.guildId, "guildId");
      const triggerChannelId = required(request.body.triggerChannelId, "triggerChannelId");
      const categoryId = String(request.body.categoryId ?? "").trim() || null;
      const rawLimit = Number(request.body.userLimit ?? 0);
      const userLimit = Number.isFinite(rawLimit)
        ? Math.max(0, Math.min(99, Math.trunc(rawLimit)))
        : 0;
      const privateByDefault = request.body.privateByDefault === "1";
      const guild = client.guilds.cache.get(guildId);

      if (!guild) throw new Error("Бот не находится на выбранном сервере.");

      if (!channelBelongsToGuild(guild, triggerChannelId, new Set([ChannelType.GuildVoice]))) {
        throw new Error("Trigger должен быть голосовым каналом выбранного сервера.");
      }

      if (categoryId && !channelBelongsToGuild(guild, categoryId, new Set([ChannelType.GuildCategory]))) {
        throw new Error("Категория не принадлежит выбранному серверу.");
      }

      store.saveTempVoice({
        guildId,
        triggerChannelId,
        categoryId,
        userLimit,
        privateByDefault
      });

      response.redirect("/?saved=voice");
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
            response.status(400).send(page("Ошибка", '<h1>Ошибка</h1><p>' + escapeHtml(message) + '</p><p><a href="/">Назад</a></p>'));
    }
  });

  app.post("/streams/add", (request, response) => {
    const providerRaw = String(request.body?.provider ?? "");
    const discordChannelId = String(request.body?.discordChannelId ?? "").trim();
    const identifier = String(request.body?.identifier ?? "").trim();
    const displayName = String(request.body?.displayName ?? "").trim();
    const template = String(request.body?.template ?? "");

    try {
      const provider = required(providerRaw, "provider");

      if (!["twitch", "youtube", "vk"].includes(provider)) {
        throw new Error("Неизвестная платформа.");
      }

      const target = [...client.guilds.cache.values()]
        .map((guild) => ({
          guild,
          channel: guild.channels.cache.get(discordChannelId)
        }))
        .find(
          (item) =>
            item.channel &&
            (item.channel.type === ChannelType.GuildText ||
              item.channel.type === ChannelType.GuildAnnouncement)
        );

      if (!target?.channel) {
        throw new Error(
          "Выбранный Discord-канал не найден в кеше бота: " + discordChannelId
        );
      }

      const sourceId = store.addStreamSource({
        provider: provider as StreamSource["provider"],
        identifier: required(identifier, "identifier"),
        displayName: required(displayName, "displayName"),
        discordChannelId,
        template: required(template, "template")
      });

      console.log(
        "[admin] stream source saved: id=" +
          sourceId +
          " provider=" +
          provider +
          " channel=" +
          target.guild.name +
          "/" +
          target.channel.name +
          " (" +
          discordChannelId +
          ")"
      );

      response.redirect(303, "/?savedSource=" + sourceId);
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      console.error("[admin] stream source save failed:", message);

      const params = new URLSearchParams({
        streamError: message,
        provider: providerRaw,
        discordChannelId,
        displayName,
        identifier,
        template
      });

      response.redirect(303, "/?" + params.toString());
    }
  });

  app.post("/streams/:id", async (request, response) => {
    try {
      const id = Number(request.params.id);
      if (!Number.isInteger(id) || id < 1) {
        throw new Error("Некорректный ID источника.");
      }

      const provider = required(request.body.provider, "provider");
      if (!["twitch", "youtube", "vk"].includes(provider)) {
        throw new Error("Неизвестная платформа.");
      }

      const discordChannelId = required(request.body.discordChannelId, "discordChannelId");
      const target = [...client.guilds.cache.values()]
        .map((guild) => ({ guild, channel: guild.channels.cache.get(discordChannelId) }))
        .find(
          (item) =>
            item.channel &&
            (item.channel.type === ChannelType.GuildText ||
              item.channel.type === ChannelType.GuildAnnouncement)
        );

      if (!target?.channel) {
        throw new Error("Выбранный Discord-канал не найден в кеше бота.");
      }

      store.updateStreamSource(id, {
        provider: provider as StreamSource["provider"],
        identifier: required(request.body.identifier, "identifier"),
        displayName: required(request.body.displayName, "displayName"),
        discordChannelId,
        template: required(request.body.template, "template")
      });

      response.redirect("/?savedSource=" + id);
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
            response.status(400).send(page("Ошибка", '<h1>Ошибка</h1><p>' + escapeHtml(message) + '</p><p><a href="/">Назад</a></p>'));
    }
  });

  app.post("/streams/poll", async (_request, response) => {
    if (!announcements) {
            response.status(503).send(page("Ошибка", '<h1>Ошибка</h1><p>Сервис анонсов ещё не подключён.</p><p><a href="/">Назад</a></p>'));
      return;
    }

    await announcements.pollNow();
    response.redirect("/");
  });

  app.post("/streams/:id/toggle", (request, response) => {
    const id = Number(request.params.id);
    const source = store.listStreamSources().find((item) => item.id === id);

    if (source) {
      store.setStreamEnabled(id, !source.enabled);
    }

    response.redirect("/");
  });

  app.post("/streams/:id/delete", (request, response) => {
    const id = Number(request.params.id);
    store.deleteStreamSource(id);
    response.redirect("/");
  });
}
