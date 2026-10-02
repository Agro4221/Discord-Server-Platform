import { EmbedBuilder, type Client } from "discord.js";
import type { Database } from "../database.js";
import type { ModuleContext, PlatformModule } from "../module.js";
import { moduleEnabled } from "../module-utils.js";
import { logger } from "../logger.js";

export type StreamAlertPlatform = "twitch" | "youtube" | "vk";
export type StreamAlertRecord = {
  id:number; guildId:string; platform:StreamAlertPlatform; target:string; targetId:string|null;
  channelId:string; mentionRoleId:string|null; enabled:boolean; intervalSeconds:number;
  lastStreamKey:string|null; lastOnline:boolean; lastCheckedAt:string|null; lastError:string|null;
};
type LiveInfo={key:string;title:string;url:string;author:string;thumbnail?:string};
export type StreamAlertsConfig={twitchClientId?:string;twitchClientSecret?:string;youtubeApiKey?:string;vkApiBaseUrl:string;pollIntervalSeconds:number};

export class StreamAlerts implements PlatformModule {
  readonly name="stream-alerts";
  private client?:Client;
  private identityId="primary";
  private timer?:NodeJS.Timeout;
  private running=false;
  private twitchToken:{value:string;expiresAt:number}|null=null;

  constructor(private readonly db:Database,private readonly config:StreamAlertsConfig){}

  async init(context:ModuleContext):Promise<void>{
    this.client=context.client;
    this.identityId=context.identityId;
    this.timer=setInterval(()=>void this.pollAll(),Math.max(15,this.config.pollIntervalSeconds)*1000);
    this.timer.unref();
  }

  async shutdown():Promise<void>{
    if(this.timer)clearInterval(this.timer);
    this.timer=undefined;
    this.client=undefined;
  }

  providers():{twitch:boolean;youtube:boolean;vk:boolean}{
    return {twitch:Boolean(this.config.twitchClientId&&this.config.twitchClientSecret),youtube:Boolean(this.config.youtubeApiKey),vk:true};
  }

  async list(guildId:string):Promise<StreamAlertRecord[]>{
    const r=await this.db.query<{
      id:string;guild_id:string;platform:StreamAlertPlatform;target:string;target_id:string|null;
      channel_id:string;mention_role_id:string|null;enabled:boolean;interval_seconds:number;
      last_stream_key:string|null;last_online:boolean;last_checked_at:string|null;last_error:string|null;
    }>(
      "SELECT id,guild_id,platform,target,target_id,channel_id,mention_role_id,enabled,interval_seconds,last_stream_key,last_online,last_checked_at,last_error FROM stream_alerts WHERE guild_id=$1 ORDER BY id DESC",[guildId]
    );
    return r.rows.map(row=>({
      id:Number(row.id),guildId:row.guild_id,platform:row.platform,target:row.target,targetId:row.target_id,
      channelId:row.channel_id,mentionRoleId:row.mention_role_id,enabled:row.enabled,intervalSeconds:row.interval_seconds,
      lastStreamKey:row.last_stream_key,lastOnline:row.last_online,lastCheckedAt:row.last_checked_at,lastError:row.last_error
    }));
  }

  async create(guildId:string,input:{platform:StreamAlertPlatform;target:string;channelId:string;mentionRoleId?:string|null;intervalSeconds:number;enabled?:boolean}):Promise<StreamAlertRecord>{
    const target=normalizeTarget(input.platform,input.target);
    const r=await this.db.query<{id:string}>(
      "INSERT INTO stream_alerts(guild_id,platform,target,channel_id,mention_role_id,interval_seconds,enabled) VALUES($1,$2,$3,$4,$5,$6,$7) RETURNING id",
      [guildId,input.platform,target,input.channelId,input.mentionRoleId??null,clampInterval(input.intervalSeconds),input.enabled!==false]
    );
    const id=r.rows[0]?.id;
    if(!id)throw new Error("stream_alert_create_failed");
    await this.db.query(
      "INSERT INTO guild_modules(guild_id,module_key,enabled) VALUES($1,$2,true) ON CONFLICT(guild_id,module_key) DO UPDATE SET enabled=true,updated_at=now()",
      [guildId,this.name]
    );
    const created=(await this.list(guildId)).find(item=>item.id===Number(id));
    if(!created)throw new Error("stream_alert_create_failed");
    return created;
  }

  async update(guildId:string,id:number,patch:{target?:string;channelId?:string;mentionRoleId?:string|null;intervalSeconds?:number;enabled?:boolean}):Promise<boolean>{
    const current=(await this.list(guildId)).find(item=>item.id===id);
    if(!current)return false;
    const target=patch.target===undefined?current.target:normalizeTarget(current.platform,patch.target);
    await this.db.query(
      "UPDATE stream_alerts SET target=$1,channel_id=$2,mention_role_id=$3,interval_seconds=$4,enabled=$5,last_error=NULL,updated_at=now() WHERE id=$6 AND guild_id=$7",
      [target,patch.channelId??current.channelId,patch.mentionRoleId===undefined?current.mentionRoleId:patch.mentionRoleId,clampInterval(patch.intervalSeconds??current.intervalSeconds),patch.enabled??current.enabled,id,guildId]
    );
    return true;
  }

  async delete(guildId:string,id:number):Promise<boolean>{
    const r=await this.db.query("DELETE FROM stream_alerts WHERE id=$1 AND guild_id=$2",[id,guildId]);
    return r.rowCount===1;
  }

  private async pollAll():Promise<void>{
    if(this.running||!this.client)return;
    this.running=true;
    try{
      const r=await this.db.query<{
        id:string;guild_id:string;platform:StreamAlertPlatform;target:string;target_id:string|null;channel_id:string;
        mention_role_id:string|null;last_stream_key:string|null;last_online:boolean;
      }>(
        "SELECT sa.id,sa.guild_id,sa.platform,sa.target,sa.target_id,sa.channel_id,sa.mention_role_id,sa.last_stream_key,sa.last_online "+
        "FROM stream_alerts sa INNER JOIN guild_bot_assignments ga ON ga.guild_id=sa.guild_id "+
        "WHERE sa.enabled=true AND (ga.bot_identity_id=$1 OR ($1='primary' AND ga.bot_identity_id<>'primary' AND NOT EXISTS ("+
        "SELECT 1 FROM bot_heartbeats bh WHERE bh.bot_identity_id=ga.bot_identity_id AND bh.last_seen_at>=now()-interval '90 seconds'))) "+
        "AND (sa.last_checked_at IS NULL OR sa.last_checked_at<=now()-make_interval(secs=>sa.interval_seconds)) "+
        "ORDER BY sa.last_checked_at NULLS FIRST LIMIT 25",
        [this.identityId]
      );
      for(const row of r.rows){
        await this.db.query("UPDATE stream_alerts SET last_checked_at=now() WHERE id=$1",[row.id]);
        await this.pollOne(row);
      }
    }catch(error){
      logger.warn("Stream alert poll cycle failed",{identityId:this.identityId,error:String(error)});
    }finally{
      this.running=false;
    }
  }

  private async pollOne(alert:{id:string;guild_id:string;platform:StreamAlertPlatform;target:string;target_id:string|null;channel_id:string;mention_role_id:string|null;last_stream_key:string|null;last_online:boolean}):Promise<void>{
    if(!await moduleEnabled(this.db,alert.guild_id,this.name,false))return;
    try{
      const live=await this.fetchLive(alert.platform,alert.target,alert.target_id);
      if(live&&(!alert.last_online||live.key!==alert.last_stream_key)){
        await this.sendAlert(alert.guild_id,alert.channel_id,alert.mention_role_id,alert.platform,live);
      }
      const targetId=alert.platform==="twitch"
        ? await this.resolveTwitchUserId(alert.target)
        : alert.platform==="youtube"
          ? await this.resolveYouTubeChannelId(alert.target,alert.target_id)
          : alert.target_id;
      await this.db.query(
        "UPDATE stream_alerts SET target_id=$1,last_stream_key=$2,last_online=$3,last_error=NULL,updated_at=now() WHERE id=$4 AND guild_id=$5",
        [targetId,live?.key??alert.last_stream_key,Boolean(live),alert.id,alert.guild_id]
      );
    }catch(error){
      await this.db.query("UPDATE stream_alerts SET last_error=$1,updated_at=now() WHERE id=$2 AND guild_id=$3",[String(error).slice(0,500),alert.id,alert.guild_id]);
      logger.warn("Stream alert provider check failed",{guildId:alert.guild_id,platform:alert.platform,target:alert.target,error:String(error)});
    }
  }

  private async fetchLive(platform:StreamAlertPlatform,target:string,targetId:string|null):Promise<LiveInfo|null>{
    if(platform==="twitch"){
      if(!this.config.twitchClientId||!this.config.twitchClientSecret)throw new Error("twitch_credentials_missing");
      const userId=targetId??await this.resolveTwitchUserId(target);
      if(!userId)throw new Error("twitch_channel_not_found");
      const token=await this.getTwitchToken();
      const r=await fetch("https://api.twitch.tv/helix/streams?user_id="+encodeURIComponent(userId),{
        headers:{"Client-Id":this.config.twitchClientId,"Authorization":"Bearer "+token},
        signal:AbortSignal.timeout(10000)
      });
      if(!r.ok)throw new Error("twitch_stream_http_"+r.status);
      const body=await r.json() as {data?:Array<{id?:string;title?:string;user_name?:string;thumbnail_url?:string}>};
      const stream=body.data?.[0];
      return stream?.id?{key:"twitch:"+stream.id,title:stream.title??"Twitch Live",url:"https://twitch.tv/"+target,author:stream.user_name??target,thumbnail:stream.thumbnail_url}:null;
    }

    if(platform==="youtube"){
      if(!this.config.youtubeApiKey)throw new Error("youtube_api_key_missing");
      const channelId=await this.resolveYouTubeChannelId(target,targetId);
      const q=new URLSearchParams({part:"snippet",channelId,eventType:"live",type:"video",maxResults:"1",key:this.config.youtubeApiKey});
      const r=await fetch("https://www.googleapis.com/youtube/v3/search?"+q.toString(),{signal:AbortSignal.timeout(10000)});
      if(!r.ok)throw new Error("youtube_search_http_"+r.status);
      const body=await r.json() as {items?:Array<{id?:{videoId?:string};snippet?:{title?:string;channelTitle?:string;thumbnails?:{high?:{url?:string}}}}>};
      const item=body.items?.[0];const videoId=item?.id?.videoId;
      return videoId?{key:"youtube:"+videoId,title:item?.snippet?.title??"YouTube Live",url:"https://www.youtube.com/watch?v="+videoId,author:item?.snippet?.channelTitle??target,thumbnail:item?.snippet?.thumbnails?.high?.url}:null;
    }

    const r=await fetch(this.config.vkApiBaseUrl+"/blog/"+encodeURIComponent(target)+"/public_video_stream",{headers:{"user-agent":"DiscordServerPlatform/0.1"},signal:AbortSignal.timeout(10000)});
    if(!r.ok)throw new Error("vk_live_http_"+r.status);
    const body=await r.json() as {title?:string;data?:Array<{vid?:string}>};
    const live=body.data?.[0];
    return live?.vid?{key:"vk:"+live.vid,title:body.title??"VK Видео Live",url:"https://live.vkvideo.ru/"+target,author:target}:null;
  }

  private async resolveTwitchUserId(login:string):Promise<string|null>{
    if(!this.config.twitchClientId||!this.config.twitchClientSecret)return null;
    const token=await this.getTwitchToken();
    const r=await fetch("https://api.twitch.tv/helix/users?login="+encodeURIComponent(login),{
      headers:{"Client-Id":this.config.twitchClientId,"Authorization":"Bearer "+token},
      signal:AbortSignal.timeout(10000)
    });
    if(!r.ok)throw new Error("twitch_user_http_"+r.status);
    const body=await r.json() as {data?:Array<{id?:string}>};
    return body.data?.[0]?.id??null;
  }

  private async resolveYouTubeChannelId(target:string,targetId:string|null):Promise<string>{
    if(targetId)return targetId;
    if(/^UC[A-Za-z0-9_-]{20,}$/.test(target))return target;
    if(!this.config.youtubeApiKey)throw new Error("youtube_api_key_missing");
    const handle=target.startsWith("@")?target:"@"+target;
    const q=new URLSearchParams({part:"id",forHandle:handle,key:this.config.youtubeApiKey});
    const r=await fetch("https://www.googleapis.com/youtube/v3/channels?"+q.toString(),{signal:AbortSignal.timeout(10000)});
    if(!r.ok)throw new Error("youtube_channel_http_"+r.status);
    const body=await r.json() as {items?:Array<{id?:string}>};
    const id=body.items?.[0]?.id;
    if(!id)throw new Error("youtube_channel_not_found");
    return id;
  }

  private async getTwitchToken():Promise<string>{
    if(this.twitchToken&&this.twitchToken.expiresAt>Date.now()+60000)return this.twitchToken.value;
    if(!this.config.twitchClientId||!this.config.twitchClientSecret)throw new Error("twitch_credentials_missing");
    const q=new URLSearchParams({client_id:this.config.twitchClientId,client_secret:this.config.twitchClientSecret,grant_type:"client_credentials"});
    const r=await fetch("https://id.twitch.tv/oauth2/token",{method:"POST",headers:{"content-type":"application/x-www-form-urlencoded"},body:q.toString(),signal:AbortSignal.timeout(10000)});
    if(!r.ok)throw new Error("twitch_token_http_"+r.status);
    const body=await r.json() as {access_token?:string;expires_in?:number};
    if(!body.access_token)throw new Error("twitch_token_missing");
    this.twitchToken={value:body.access_token,expiresAt:Date.now()+Math.max(60,Number(body.expires_in??3600))*1000};
    return body.access_token;
  }

  private async sendAlert(guildId:string,channelId:string,mentionRoleId:string|null,platform:StreamAlertPlatform,live:LiveInfo):Promise<void>{
    const channel=this.client?.guilds.cache.get(guildId)?.channels.cache.get(channelId);
    if(!channel?.isTextBased()||!("send" in channel))throw new Error("stream_alert_channel_unavailable");
    const names:Record<StreamAlertPlatform,string>={twitch:"Twitch",youtube:"YouTube",vk:"VK Видео Live"};
    const embed=new EmbedBuilder().setTitle("🔴 "+names[platform]+" — эфир начался").setDescription("**"+live.title+"**").setURL(live.url).addFields({name:"Канал",value:live.author,inline:true}).setTimestamp();
    if(live.thumbnail)embed.setThumbnail(live.thumbnail);
    await channel.send({
      content:mentionRoleId?"<@&"+mentionRoleId+">":undefined,
      embeds:[embed],
      allowedMentions:mentionRoleId?{roles:[mentionRoleId]}:{parse:[]}
    });
  }
}

function normalizeTarget(platform:StreamAlertPlatform,raw:string):string{
  const value=raw.trim();if(!value)throw new Error("stream_alert_target_required");
  if(platform==="youtube"){
    const channelMatch=value.match(/youtube\.com\/channel\/(UC[A-Za-z0-9_-]{20,})/i);
    if(channelMatch?.[1])return channelMatch[1];
    const handleMatch=value.match(/youtube\.com\/@([A-Za-z0-9._-]+)/i);
    if(handleMatch?.[1])return "@"+handleMatch[1];
    return value.startsWith("@")?value:"@"+value;
  }
  return value.replace(/^https?:\/\/[^/]+\//i,"").split(/[?#/]/)[0]??value;
}

function clampInterval(value:number):number{
  if(!Number.isFinite(value))throw new Error("invalid_stream_alert_interval");
  return Math.min(Math.max(Math.trunc(value),15),3600);
}
