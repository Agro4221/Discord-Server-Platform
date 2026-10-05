export type DiscordBotCredentialCheck = {
  id: string;
  username: string;
  bot: boolean;
};

export async function verifyDiscordBotCredentials(
  clientId: string,
  token: string,
  fetcher: typeof fetch = fetch
): Promise<DiscordBotCredentialCheck> {
  if (!/^\d{17,20}$/.test(clientId)) throw new Error("invalid_discord_client_id");
  if (!token || token.length > 512) throw new Error("invalid_discord_bot_token");

  const response = await fetcher("https://discord.com/api/v10/users/@me", {
    headers: { Authorization: "Bot " + token },
    signal: AbortSignal.timeout(10_000)
  });
  if (!response.ok) throw new Error("discord_bot_credentials_http_" + response.status);

  const user = await response.json() as { id?: string; username?: string; bot?: boolean };
  if (user.id !== clientId) throw new Error("discord_bot_client_id_mismatch");
  if (user.bot !== true) throw new Error("discord_account_is_not_bot");
  if (!user.id || !user.username) throw new Error("discord_bot_identity_invalid");

  return {
    id: user.id,
    username: user.username,
    bot: true
  };
}
