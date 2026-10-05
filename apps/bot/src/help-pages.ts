import type { Database } from "./database.js";

export type HelpPage = {
  slug: string;
  title: string;
  content: string;
  enabled: boolean;
  updatedAt: string;
};

export class HelpPages {
  constructor(private readonly db: Database) {}

  async list(guildId: string): Promise<HelpPage[]> {
    const result = await this.db.query<{
      slug: string;
      title: string;
      content: string;
      enabled: boolean;
      updated_at: string;
    }>(
      "SELECT slug,title,content,enabled,updated_at FROM help_pages WHERE guild_id=$1 ORDER BY updated_at DESC,slug",
      [guildId]
    );
    return result.rows.map((row) => ({
      slug: row.slug,
      title: row.title,
      content: row.content,
      enabled: row.enabled,
      updatedAt: row.updated_at
    }));
  }

  async get(guildId: string, slug: string): Promise<HelpPage | null> {
    const normalized = normalizeHelpSlug(slug);
    if (!normalized) return null;
    const result = await this.db.query<{
      slug: string;
      title: string;
      content: string;
      enabled: boolean;
      updated_at: string;
    }>(
      "SELECT slug,title,content,enabled,updated_at FROM help_pages WHERE guild_id=$1 AND slug=$2",
      [guildId, normalized]
    );
    const row = result.rows[0];
    return row
      ? {
          slug: row.slug,
          title: row.title,
          content: row.content,
          enabled: row.enabled,
          updatedAt: row.updated_at
        }
      : null;
  }

  async save(
    guildId: string,
    slug: string,
    title: string,
    content: string,
    enabled = true
  ): Promise<HelpPage> {
    const normalizedSlug = normalizeHelpSlug(slug);
    const normalizedTitle = title.trim().slice(0, 100);
    const normalizedContent = content.trim().slice(0, 3900);
    if (!normalizedSlug) throw new Error("invalid_help_page_slug");
    if (!normalizedTitle) throw new Error("invalid_help_page_title");
    if (!normalizedContent) throw new Error("invalid_help_page_content");

    await this.db.query(
      "INSERT INTO help_pages(guild_id,slug,title,content,enabled) VALUES($1,$2,$3,$4,$5) ON CONFLICT(guild_id,slug) DO UPDATE SET title=EXCLUDED.title,content=EXCLUDED.content,enabled=EXCLUDED.enabled,updated_at=now()",
      [guildId, normalizedSlug, normalizedTitle, normalizedContent, enabled]
    );
    const page = await this.get(guildId, normalizedSlug);
    if (!page) throw new Error("help_page_save_failed");
    return page;
  }

  async delete(guildId: string, slug: string): Promise<boolean> {
    const normalizedSlug = normalizeHelpSlug(slug);
    if (!normalizedSlug) throw new Error("invalid_help_page_slug");
    const result = await this.db.query(
      "DELETE FROM help_pages WHERE guild_id=$1 AND slug=$2",
      [guildId, normalizedSlug]
    );
    return result.rowCount === 1;
  }
}

export function normalizeHelpSlug(value: string): string {
  const slug = value.trim().toLowerCase();
  return /^[a-z0-9_-]{1,40}$/.test(slug) ? slug : "";
}
