import type { ChatInputCommandInteraction, Invite } from "discord.js";
import type { Database } from "../database.js";
import type { ModuleContext, PlatformModule } from "../module.js";
import { moduleEnabled } from "../module-utils.js";
import { logger } from "../logger.js";

export class InviteTracking implements PlatformModule {
  readonly name = "invite-tracking";
  private unsubscribe?: () => void;
  private client?: ModuleContext["client"];
  private readonly cache = new Map<string, Map<string, number>>();

  constructor(private readonly db: Database) {}

  async init(context: ModuleContext): Promise<void> {
    this.client = context.client;
    const memberAdd = context.events.on("member.add", (member) => this.onMemberAdd(member));
    this.unsubscribe = () => memberAdd();
    for (const guild of context.client.guilds.cache.values()) await this.refreshGuild(guild.id);
  }

  async shutdown(): Promise<void> {
    this.unsubscribe?.();
    this.unsubscribe = undefined;
    this.client = undefined;
    this.cache.clear();
  }

  private async onMemberAdd(member: import("discord.js").GuildMember): Promise<void> {
    if (!await moduleEnabled(this.db, member.guild.id, "invite-tracking", false)) return;
    const previous = this.cache.get(member.guild.id) ?? new Map<string, number>();
    const current = await member.guild.invites.fetch().catch(() => null);
    if (!current) {
      await this.db.query(
        "INSERT INTO invite_events(guild_id,user_id,inviter_id,invite_code) VALUES($1,$2,NULL,NULL)",
        [member.guild.id,member.id]
      ).catch(() => undefined);
      return;
    }

    const fresh = new Map<string, number>();
    let used: { code:string; inviterId:string|null; delta:number } | null = null;
    for (const invite of current.values()) {
      const uses = Number(invite.uses ?? 0);
      fresh.set(invite.code, uses);
      const delta = uses - Number(previous.get(invite.code) ?? 0);
      if (delta > 0 && (!used || delta > used.delta)) {
        used = { code:invite.code, inviterId:invite.inviter?.id ?? null, delta };
      }
    }
    this.cache.set(member.guild.id, fresh);

    const inviterId = used?.inviterId ?? null;
    await this.db.query(
      "INSERT INTO invite_events(guild_id,user_id,inviter_id,invite_code) VALUES($1,$2,$3,$4)",
      [member.guild.id,member.id,inviterId,used?.code ?? null]
    ).catch((error) => logger.warn("Invite event persistence failed",{guildId:member.guild.id,error:String(error)}));

    if (inviterId && inviterId !== member.id) {
      await this.db.query(
        "INSERT INTO invite_stats(guild_id,user_id,joins) VALUES($1,$2,1) ON CONFLICT(guild_id,user_id) DO UPDATE SET joins=invite_stats.joins+1,updated_at=now()",
        [member.guild.id,inviterId]
      );
    }
  }

  private async refreshGuild(guildId:string):Promise<void> {
    const guild=this.client?.guilds.cache.get(guildId);
    if(!guild) return;
    const invites=await guild.invites.fetch().catch(()=>null);
    if(!invites) return;
    const map=new Map<string,number>();
    for(const invite of invites.values()) map.set(invite.code,Number(invite.uses ?? 0));
    this.cache.set(guildId,map);
  }

  async onCommand(interaction: ChatInputCommandInteraction): Promise<void> {
    if(!interaction.inGuild() || interaction.commandName!=="invites") return;
    if(!await moduleEnabled(this.db,interaction.guild!.id,"invite-tracking",false)){
      await interaction.reply({content:"Модуль Invite Tracking выключен.",ephemeral:true});
      return;
    }
    const user=interaction.options.getUser("user") ?? interaction.user;
    const result=await this.db.query<{joins:number}>("SELECT joins FROM invite_stats WHERE guild_id=$1 AND user_id=$2",[interaction.guild!.id,user.id]);
    const total=Number(result.rows[0]?.joins ?? 0);
    const recent=await this.db.query<{member_id:string;created_at:Date}>(
      "SELECT user_id AS member_id,created_at FROM invite_events WHERE guild_id=$1 AND inviter_id=$2 ORDER BY created_at DESC LIMIT 10",[interaction.guild!.id,user.id]
    );
    const lines=recent.rows.map((row,index)=>(index+1)+". <@"+row.member_id+"> · <t:"+Math.floor(row.created_at.getTime()/1000)+":R>");
    await interaction.reply({content:"📨 <@"+user.id+"> пригласил **"+total+"** участников."+ (lines.length ? "\n\nПоследние:\n"+lines.join("\n") : ""),ephemeral:false});
  }
}
