import { EmbedBuilder, type Client } from "discord.js";
import { spawn } from "node:child_process";
import type { Database } from "../database.js";
import type { ModuleContext, PlatformModule } from "../module.js";
import { moduleEnabled } from "../module-utils.js";
import { logger } from "../logger.js";

export type StreamAlertPlatform = "twitch" | "youtube" | "vk";
export type StreamAlertRecord = {
  id:number; guildId:string; platform:StreamAlertPlatform; target:string; targetId:string|null;
  displayName:string; template:string;
  channelId:string; mentionRoleId:string|null; enabled:boolean; intervalSeconds:number;
  lastStreamKey:string|null; lastOnline:boolean; lastCheckedAt:string|null; lastError:string|null;
};
type LiveInfo={key:string;title:string;url:string;author:string;thumbnail?:string};
type ProcessResult={code:number|null;stdout:string;stderr:string};
const DEFAULT_STREAM_ALERT_TEMPLATE="Хей! {channel} запустил стрим на канале. Присоединяйся!\\n{url}";
function renderStreamAlertTemplate(template:string,values:Record<string,string|number|undefined>):string{
  return template.replace(/\{([a-zA-Z0-9_]+)\}/g,(_match,key:string)=>{
    const value=values[key];
    return value===undefined?"{"+key+"}":String(value);
  }).replaceAll("\\n","\n");
}
function escapeDiscordText(value:string):string{
  return value.replace(/[\\*_~|>]/g,"\\type ProcessResult={code:number|null;stdout:string;stderr:string};
async function runProcess").replaceAll(String.fromCharCode(96),"\\\"+String.fromCharCode(96));
}
async function runProcess(command:string,args:string[],timeoutMs:number):Promise<ProcessResult>{
  return await new Promise<ProcessResult>((resolve)=>{
    const child=spawn(command,args,{windowsHide:true});
    let stdout="";let stderr="";let settled=false;
    const finish=(result:ProcessResult)=>{if(settled)return;settled=true;clearTimeout(timer);resolve(result);};
    child.stdout.on("data",(chunk:Buffer|string)=>{stdout+=chunk.toString();});
    child.stderr.on("data",(chunk:Buffer|string)=>{stderr+=chunk.toString();});
    child.once("error",(error)=>finish({code:null,stdout,stderr:stderr+String(error)}));
    child.once("close",(code)=>finish({code,stdout,stderr}));
    const timer=setTimeout(()=>{child.kill();finish({code:null,stdout,stderr:stderr+"\nprocess_timeout"});},timeoutMs);
  });
}

export type StreamAlertsConfig={twitchClientId?:string;twitchClientSecret?:string;youtubeApiKey?:string;vkApiBaseUrl:string;pollIntervalSeconds:number;ytDlpPath:string;ytDlpJsRuntime?:string;ytDlpCookiesFile?:string};

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
    context.client.once("ready",()=>void this.pollAll());
  }

  async shutdown():Promise<void>{
    if(this.timer)clearInterval(this.timer);
    this.timer=undefined;
    this.client=undefined;
  }

  providers():{twitch:boolean;youtube:boolean;vk:boolean}{
    return {twitch:Boolean(this.config.twitchClientId&&this.config.twitchClientSecret),youtube:Boolean(this.config.ytDlpPath),vk:true};
  }

  async list(guildId:string):Promise<StreamAlertRecord[]>{
    const r=await this.db.query<{
      id:string;guild_id:string;platform:StreamAlertPlatform;target:string;target_id:string|null;
      display_name:string;template:string;
      channel_id:string;mention_role_id:string|null;enabled:boolean;interval_seconds:number;
      last_stream_key:string|null;last_online:boolean;last_checked_at:string|null;last_error:string|null;
    }>(
      "SELECT id,guild_id,platform,target,target_id,display_name,template,channel_id,mention_role_id,enabled,interval_seconds,last_stream_key,last_online,last_checked_at,last_error FROM stream_alerts WHERE guild_id=$1 ORDER BY id DESC",[guildId]
    );
    return r.rows.map(row=>({
      id:Number(row.id),guildId:row.guild_id,platform:row.platform,target:row.target,targetId:row.target_id,
      displayName:row.display_name,template:row.template,
      channelId:row.channel_id,mentionRoleId:row.mention_role_id,enabled:row.enabled,intervalSeconds:row.interval_seconds,
      lastStreamKey:row.last_stream_key,lastOnline:row.last_online,lastCheckedAt:row.last_checked_at,lastError:row.last_error
    }));
  }

  async create(guildId:string,input:{platform:StreamAlertPlatform;target:string;displayName:string;template:string;channelId:string;mentionRoleId?:string|null;intervalSeconds:number;enabled?:boolean}):Promise<StreamAlertRecord>{
    const target=normalizeStreamAlertTarget(input.platform,input.target);
    const displayName=(input.displayName.trim()||target).slice(0,200);
    const template=(input.template||DEFAULT_STREAM_ALERT_TEMPLATE).slice(0,1000);
    const r=await this.db.query<{id:string}>(
      "INSERT INTO stream_alerts(guild_id,platform,target,display_name,template,channel_id,mention_role_id,interval_seconds,enabled) VALUES($1,$2,$3,$4,$5,$6,$7,$8,$9) RETURNING id",
      [guildId,input.platform,target,displayName,template,input.channelId,input.mentionRoleId??null,clampStreamAlertInterval(input.intervalSeconds),input.enabled!==false]
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

  async update(guildId:string,id:number,patch:{platform?:StreamAlertPlatform;target?:string;displayName?:string;template?:string;channelId?:string;mentionRoleId?:string|null;intervalSeconds?:number;enabled?:boolean}):Promise<boolean>{
    const current=(await this.list(guildId)).find(item=>item.id===id);
    if(!current)return false;
    const platform=patch.platform??current.platform;
    const target=patch.target===undefined?current.target:normalizeStreamAlertTarget(platform,patch.target);
    const displayName=patch.displayName===undefined?current.displayName:(patch.displayName.trim()||target).slice(0,200);
    const template=patch.template===undefined?current.template:(patch.template||DEFAULT_STREAM_ALERT_TEMPLATE).slice(0,1000);
    const providerChanged=platform!==current.platform||target!==current.target;
    await this.db.query(
      "UPDATE stream_alerts SET platform=$1,target=$2,display_name=$3,template=$4,channel_id=$5,mention_role_id=$6,interval_seconds=$7,enabled=$8,target_id=$9,last_stream_key=$10,last_online=$11,last_error=NULL,updated_at=now() WHERE id=$12 AND guild_id=$13",
      [platform,target,displayName,template,patch.channelId??current.channelId,patch.mentionRoleId===undefined?current.mentionRoleId:patch.mentionRoleId,clampStreamAlertInterval(patch.intervalSeconds??current.intervalSeconds),patch.enabled??current.enabled,providerChanged?null:current.targetId,providerChanged?null:current.lastStreamKey,providerChanged?false:current.lastOnline,id,guildId]
    );
    return true;
  }

  async delete(guildId:string,id:number):Promise<boolean>{
    const r=await this.db.query("DELETE FROM stream_alerts WHERE id=$1 AND guild_id=$2",[id,guildId]);
    return r.rowCount===1;
  }

  async checkNow(guildId:string,id:number):Promise<StreamAlertRecord|null>{
    const current=(await this.list(guildId)).find(item=>item.id===id);
    if(!current)return null;
    await this.db.query("UPDATE stream_alerts SET last_checked_at=now() WHERE id=$1 AND guild_id=$2",[id,guildId]);
    await this.pollOne({id:String(current.id),guild_id:current.guildId,platform:current.platform,target:current.target,target_id:current.targetId,display_name:current.displayName,template:current.template,channel_id:current.channelId,mention_role_id:current.mentionRoleId,last_stream_key:current.lastStreamKey,last_online:current.lastOnline});
    return (await this.list(guildId)).find(item=>item.id===id)??null;
  }

  private async pollAll():Promise<void>{
    if(this.running||!this.client)return;
    this.running=true;
    try{
      const r=await this.db.query<{
        id:string;guild_id:string;platform:StreamAlertPlatform;target:string;target_id:string|null;display_name:string;template:string;channel_id:string;
        mention_role_id:string|null;last_stream_key:string|null;last_online:boolean;
      }>(
        "SELECT sa.id,sa.guild_id,sa.platform,sa.target,sa.target_id,sa.display_name,sa.template,sa.channel_id,sa.mention_role_id,sa.last_stream_key,sa.last_online "+
        "FROM stream_alerts sa LEFT JOIN guild_bot_assignments ga ON ga.guild_id=sa.guild_id "+
        "WHERE sa.enabled=true AND ("+
        "ga.bot_identity_id=$1 OR "+
        "($1='primary' AND (ga.guild_id IS NULL OR (ga.bot_identity_id<>'primary' AND NOT EXISTS ("+
        "SELECT 1 FROM bot_heartbeats bh WHERE bh.bot_identity_id=ga.bot_identity_id AND bh.last_seen_at>=now()-interval '90 seconds'))))"+
        ") "+
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

  private async pollOne(alert:{id:string;guild_id:string;platform:StreamAlertPlatform;target:string;target_id:string|null;display_name:string;template:string;channel_id:string;mention_role_id:string|null;last_stream_key:string|null;last_online:boolean}):Promise<void>{
    if(!await moduleEnabled(this.db,alert.guild_id,this.name,false))return;
    try{
      const live=await this.fetchLive(alert.platform,alert.target,alert.target_id);
      if(live&&(!alert.last_online||live.key!==alert.last_stream_key)){
        await this.sendAlert(alert.guild_id,alert.channel_id,alert.mention_role_id,alert.platform,alert.display_name,alert.template,live);
      }
      const targetId=alert.platform==="twitch"
        ? await this.resolveTwitchUserId(alert.target)
        : alert.platform==="youtube"
          ? (alert.target_id??(/^UC[A-Za-z0-9_-]{20,}$/.test(alert.target)?alert.target:null))
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
      return await this.fetchYouTubeLiveViaYtDlp(target,targetId);
    }

    return await this.fetchVkLive(target);
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

  private async fetchYouTubeLiveViaYtDlp(target:string,targetId:string|null):Promise<LiveInfo|null>{
    const liveUrl=buildYouTubeLiveUrl(target,targetId);
    const result=await runProcess(this.config.ytDlpPath,[
      liveUrl,
      "--flat-playlist",
      "--playlist-end","1",
      "--dump-single-json",
      "--skip-download",
      "--no-warnings"
    ],30000);

    if(result.code!==0){
      if(/not currently live|not live|offline|no live|does not currently have a live/i.test(result.stderr))return null;
      throw new Error("youtube_ytdlp_failed:"+result.stderr.slice(0,400));
    }

    let data:any;
    try{data=JSON.parse(result.stdout);}
    catch{throw new Error("youtube_ytdlp_invalid_json");}

    const entry=Array.isArray(data.entries)?data.entries[0]:undefined;
    const id=data.id??entry?.id;
    if(!id)return null;

    const liveStatus=String(data.live_status??entry?.live_status??"").toLowerCase();
    const isLive=data.is_live===true||entry?.is_live===true||liveStatus==="is_live"||liveStatus==="live"||!liveStatus;
    if(!isLive)return null;

    const url=data.webpage_url??entry?.webpage_url??entry?.url??("https://www.youtube.com/watch?v="+id);
    logger.info("YouTube live detected via yt-dlp",{target,videoId:id});
    return {
      key:"youtube:"+id,
      title:data.title??entry?.title??"YouTube Live",
      url,
      author:String(data.channel??entry?.channel??data.uploader??entry?.uploader??target),
      thumbnail:data.thumbnail??entry?.thumbnail
    };
  }

  private async fetchVkLive(target:string):Promise<LiveInfo|null>{
    const slug=normalizeVkStreamTarget(target);
    if(!slug)throw new Error("vk_channel_required");

    const apiUrl=this.config.vkApiBaseUrl+"/blog/"+encodeURIComponent(slug)+"/public_video_stream";
    try{
      const r=await fetch(apiUrl,{
        headers:{
          Referer:"https://live.vkvideo.ru/"+encodeURIComponent(slug),
          "user-agent":"stream-bot-lite/0.1"
        },
        signal:AbortSignal.timeout(10000)
      });
      if(r.ok){
        const body=await r.json() as {title?:string;data?:Array<{vid?:string}>};
        const live=body.data?.[0];
        if(live?.vid){
          return {key:"vk:"+live.vid,title:body.title??"VK Видео Live",url:"https://live.vkvideo.ru/"+encodeURIComponent(slug),author:slug};
        }
        return null;
      }
    }catch(error){
      logger.warn("VK API check failed; using yt-dlp fallback",{target,error:String(error)});
    }

    const liveUrl="https://live.vkvideo.ru/"+encodeURIComponent(slug);
    const result=await runProcess(this.config.ytDlpPath,[
      liveUrl,
      "--dump-single-json",
      "--skip-download",
      "--no-warnings"
    ],30000);

    if(result.code!==0){
      if(/not live|offline|no live|does not currently have a live/i.test(result.stderr))return null;
      throw new Error("vk_ytdlp_failed:"+result.stderr.slice(0,400));
    }

    let data:any;
    try{data=JSON.parse(result.stdout);}
    catch{throw new Error("vk_ytdlp_invalid_json");}

    const isLive=data.is_live===true||data.live_status==="is_live"||data.live_status==="live";
    if(!isLive||!data.id)return null;

    return {
      key:"vk:"+data.id,
      title:data.title??"VK Видео Live",
      url:data.webpage_url??liveUrl,
      author:slug,
      thumbnail:data.thumbnail
    };
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

  private async sendAlert(guildId:string,channelId:string,mentionRoleId:string|null,platform:StreamAlertPlatform,displayName:string,template:string,live:LiveInfo):Promise<void>{
    const guild=this.client?.guilds.cache.get(guildId);
    let channel=guild?.channels.cache.get(channelId);
    if(!channel)channel=await guild?.channels.fetch(channelId).catch(()=>undefined)??undefined;
    if(!channel?.isTextBased()||!("send" in channel))throw new Error("stream_alert_channel_unavailable");
    const names:Record<StreamAlertPlatform,string>={twitch:"Twitch",youtube:"YouTube",vk:"VK Видео Live"};
    const platformName=names[platform];
    const content=renderStreamAlertTemplate(template||DEFAULT_STREAM_ALERT_TEMPLATE,{
      platform:platformName,
      channel:escapeDiscordText(displayName),
      title:escapeDiscordText(live.title),
      url:live.url,
      viewers:undefined,
      category:undefined
    });
    const headline=displayName+" запустил вещание на "+platformName+"!";
    const embed=new EmbedBuilder().setTitle(headline.slice(0,256)).setDescription("**"+live.title.slice(0,900)+"**").setURL(live.url).addFields({name:"Канал",value:escapeDiscordText(displayName).slice(0,1024),inline:true}).setTimestamp();
    if(live.thumbnail)embed.setThumbnail(live.thumbnail);
    const mentionPrefix=mentionRoleId?"<@&"+mentionRoleId+">\n":"";
    const payloadContent=(mentionPrefix+content).slice(0,4000);
    const allowedMentions=mentionRoleId?{roles:[mentionRoleId],parse:[] as ("users"|"roles"|"everyone")[]}:{parse:["users","roles","everyone"] as ("users"|"roles"|"everyone")[]};
    try{
      await channel.send({content:payloadContent,embeds:[embed],allowedMentions});
    }catch(error){
      logger.warn("Stream alert embed send failed; using plain message",{guildId,channelId,platform,error:String(error)});
      await channel.send({content:payloadContent,allowedMentions});
    }
  }
}

export function buildYouTubeLiveUrl(identifier:string,targetId:string|null):string{
  const value=identifier.trim();
  if(targetId)return "https://www.youtube.com/channel/"+encodeURIComponent(targetId)+"/live";

  if(/^https?:\/\//i.test(value)){
    try{
      const url=new URL(value);
      const host=url.hostname.toLowerCase();
      if(host==="youtu.be"||url.pathname.startsWith("/watch")||url.pathname.startsWith("/live/"))return value;
      if(host==="youtube.com"||host==="www.youtube.com"||host.endsWith(".youtube.com")){
        if(url.pathname.startsWith("/@")||url.pathname.startsWith("/channel/")||url.pathname.startsWith("/c/")||url.pathname.startsWith("/user/")){
          url.pathname=url.pathname.replace(/\/$/,"")+"/live";
          return url.toString();
        }
      }
    }catch{
      return value;
    }
    return value;
  }

  if(value.startsWith("@"))return "https://www.youtube.com/"+encodeURIComponent(value)+"/live";
  if(/^UC[A-Za-z0-9_-]{20,}$/i.test(value))return "https://www.youtube.com/channel/"+encodeURIComponent(value)+"/live";
  return "https://www.youtube.com/@"+encodeURIComponent(value)+"/live";
}

export function normalizeVkStreamTarget(identifier:string):string{
  const value=identifier.trim();
  try{
    const url=new URL(value);
    const host=url.hostname.toLowerCase();
    if(host==="live.vkvideo.ru"||host.endsWith(".vkvideo.ru"))return url.pathname.split("/").filter(Boolean)[0]??"";
  }catch{
    // Treat it as a slug.
  }
  return value.replace(/^@/,"").replace(/^\//,"").split(/[?#/]/,1)[0]??"";
}

export function normalizeStreamAlertTarget(platform:StreamAlertPlatform,raw:string):string{
  const value=raw.trim();if(!value)throw new Error("stream_alert_target_required");
  if(platform==="youtube"){
    const channelMatch=value.match(/youtube\.com\/channel\/(UC[A-Za-z0-9_-]{20,})/i);
    if(channelMatch?.[1])return channelMatch[1];
    const handleMatch=value.match(/youtube\.com\/@([A-Za-z0-9._-]+)/i);
    if(handleMatch?.[1])return "@"+handleMatch[1];
    if(/^UC[A-Za-z0-9_-]{20,}$/i.test(value))return value;
    return value.startsWith("@")?value:"@"+value;
  }
  return value.replace(/^https?:\/\/[^/]+\//i,"").split(/[?#/]/)[0]??value;
}

export function clampStreamAlertInterval(value:number):number{
  if(!Number.isFinite(value))throw new Error("invalid_stream_alert_interval");
  return Math.min(Math.max(Math.trunc(value),15),3600);
}
