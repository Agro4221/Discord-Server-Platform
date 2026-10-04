    const window = this.rateWindows.get(key);

    if (!window || now - window.startedAt >= 60_000) {
      this.rateWindows.set(key, { startedAt: now, count: 1 });
      return true;
    }

    window.count += 1;
    return window.count <= limit;
  }

  private json(res: ServerResponse, status: number, body: unknown): void {
    res.writeHead(status, {
      "content-type": "application/json; charset=utf-8",
      "cache-control": "no-store",
      "x-content-type-options": "nosniff"
    });
    res.end(JSON.stringify(body));
  }
}

class RequestInputError extends Error {
  constructor(
    readonly code: string,
    readonly status: number
  ) {
    super(code);
  }
}

export function validateAutomationPayload(
  client: Client,
  guildId: string,
  event: string,
  conditions: unknown[],
  actions: unknown[]
): void {
  const supportedEvents = new Set([
    "member.join","member.leave","member.role.add","member.role.remove",
    "message.create","message.delete","message.edit","reaction.add","reaction.remove",
    "channel.update","role.update",
    "voice.join","voice.leave","voice.move","moderation.case",
    "ticket.create","ticket.close","giveaway.end","schedule",
    "channel.create","channel.delete","role.create","role.delete",
    "member.ban","member.unban","security.incident"
  ]);
  if (!supportedEvents.has(event)) throw new RequestInputError("unsupported_automation_event", 400);

  const guild = client.guilds.cache.get(guildId);
  if (!guild) throw new RequestInputError("guild_not_found", 404);

  const stringFields = new Set(["content","userId","channelId","previousChannelId","messageId","guildId"]);
  const numericFields = new Set([
    "memberCount","messageLength","mentionCount","previousLength","attachmentCount","embedCount","stickerCount",
    "giveawayId","winnerCount","rolePosition","incidentId","actionCount","joinCount",
    "timestamp","minute","hour","dayOfWeek","dayOfMonth"
  ]);

  for (const condition of conditions) {
    if (!condition || typeof condition !== "object" || Array.isArray(condition)) {
      throw new RequestInputError("invalid_automation_condition", 400);
    }
    const item = condition as Record<string, unknown>;

    switch (item.type) {
      case "channel-is": {
        if (typeof item.channelId !== "string" || !/^\d{17,20}$/.test(item.channelId)) {
          throw new RequestInputError("invalid_condition_channel", 400);
        }
        const channel = guild.channels.cache.get(item.channelId);
        if (!channel || !channel.isTextBased()) throw new RequestInputError("invalid_condition_channel", 400);
        break;
      }
      case "contains":
      case "starts-with":
      case "ends-with":
      case "equals":
        if (
          typeof item.left !== "string" ||
          !stringFields.has(item.left) ||
          typeof item.right !== "string" ||
          item.right.length > 200
        ) {
          throw new RequestInputError("invalid_content_condition", 400);
        }
        break;
      case "matches":
        if (
          typeof item.left !== "string" ||
          !stringFields.has(item.left) ||
          typeof item.pattern !== "string" ||
          item.pattern.length > 120
        ) {
          throw new RequestInputError("invalid_regex_condition", 400);
        }
        try { new RegExp(item.pattern); } catch {
          throw new RequestInputError("invalid_regex_condition", 400);
        }
        break;
      case "number-gte":
      case "number-lte":
      case "number-eq":
      case "number-gt":
      case "number-lt":
        if (
          typeof item.left !== "string" ||
          !numericFields.has(item.left) ||
          typeof item.right !== "number" ||
          !Number.isFinite(item.right)
        ) {
          throw new RequestInputError("invalid_numeric_condition", 400);
        }
        break;
      case "has-role":
        if (
          typeof item.userId !== "string" ||
          (item.userId !== "@event" && !/^\d{17,20}$/.test(item.userId)) ||
          typeof item.roleId !== "string" ||
          !/^\d{17,20}$/.test(item.roleId) ||
          !guild.roles.cache.has(item.roleId)
        ) {
          throw new RequestInputError("invalid_role_condition", 400);
        }
        break;
      case "cooldown-clear":
        if (typeof item.key !== "string" || !item.key.trim() || item.key.length > 100) {
          throw new RequestInputError("invalid_cooldown_key", 400);
        }