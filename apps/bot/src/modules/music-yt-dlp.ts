import {
  ActionRowBuilder, ButtonBuilder, ButtonStyle, EmbedBuilder,
  type ChatInputCommandInteraction, type Client, type Guild, type GuildMember, type Interaction, type Message
} from "discord.js";
import {
  AudioPlayerStatus, NoSubscriberBehavior, StreamType, VoiceConnectionStatus,
  createAudioPlayer, createAudioResource, entersState, joinVoiceChannel,
  type AudioPlayer, type AudioResource, type VoiceConnection
} from "@discordjs/voice";
import { spawn, type ChildProcessWithoutNullStreams } from "node:child_process";
import type { Database } from "../database.js";
import type { AppConfig } from "../config.js";
import type { BotIdentityRepository } from "../bot-identity.js";
import type { ModuleContext, PlatformModule } from "../module.js";
import { moduleEnabled } from "../module-utils.js";
import { logger } from "../logger.js";

export type MusicRepeatMode = "off"|"track"|"queue";
export type MusicSearchProvider = "auto"|"youtube"|"tiktok"|"yandex_music"|"vk_music"|"spotify"|"soundcloud";
export type MusicFilterPreset = "off"|"nightcore"|"vaporwave"|"karaoke"|"rotation"|"tremolo"|"vibrato"|"lowpass";
export const MAX_MUSIC_ENQUEUE_TRACKS = 100;

export type MusicTrack = { id:string; title:string; author:string; durationMs:number; url:string };
type Result = { code:number; stdout:string; stderr:string };
type Session = {
  guildId:string; voiceChannelId:string; textChannelId:string|null;
  player:AudioPlayer; connection:VoiceConnection; queue:MusicTrack[]; current:MusicTrack|null;
  positionMs:number; positionChangedAt:number; paused:boolean; volume:number; repeatMode:MusicRepeatMode;
  autoplay:boolean; filter:MusicFilterPreset; ffmpeg:ChildProcessWithoutNullStreams|null;
  resource:AudioResource|null; intentionalStop:boolean; transitioning:boolean;
  controllerMessageId:string|null; autoLeaveTimer:NodeJS.Timeout|null;
};

export class YtDlpMusicEngine implements PlatformModule {
  readonly name="music";
  private client?:Client;
  private setModuleHealth?:ModuleContext["setModuleHealth"];
  private unsubscribe?:()=>void;
  private ready=false;
  private readonly sessions=new Map<string,Session>();

  constructor(
    private readonly db:Database,
    private readonly config:AppConfig,
    private readonly identities:BotIdentityRepository
  ) {}

  async init(context:ModuleContext):Promise<void> {
    this.client=context.client; this.setModuleHealth=context.setModuleHealth;
    this.ready=await this.verifyTooling();
    this.setModuleHealth?.(this.name,this.ready?"ready":"degraded");
    const a=context.events.on("interaction.command",i=>this.executeSlashCommand(i));
    const b=context.events.on("interaction",i=>this.onInteraction(i));
    this.unsubscribe=()=>{a();b();};
    context.client.once("ready",()=>void this.restore());
    logger.info("Music engine initialized",{engine:"yt-dlp+ffmpeg",ready:this.ready,identity:this.config.botIdentityId});
  }

  async shutdown():Promise<void>{
    this.unsubscribe?.(); this.unsubscribe=undefined;
    const sessions=[...this.sessions.values()]; this.sessions.clear();
    for(const s of sessions) await this.destroy(s,true);
    this.client=undefined; this.setModuleHealth=undefined;
  }

  async dashboardState(guildId:string){
    const s=this.sessions.get(guildId), current=s?.current??null;
    return {
      enabled:await moduleEnabled(this.db,guildId,"music",false),
      initialized:this.ready, voiceChannelId:s?.voiceChannelId??null, textChannelId:s?.textChannelId??null,
      paused:s?.paused??false, volume:s?.volume??100, repeatMode:s?.repeatMode??"off",
      autoplay:s?.autoplay??await this.getAutoplay(guildId), filters:s&&s.filter!=="off"?[s.filter]:[],
      current:current?{title:current.title,author:current.author,durationMs:current.durationMs,positionMs:this.position(s!)}:null,
      queue:(s?.queue??[]).slice(0,25).map(t=>({title:t.title,author:t.author,durationMs:t.durationMs})),
      nodeCount:this.ready?1:0, nodeId:this.ready?"local":null
    };
  }

  async dashboardControl(guildId:string,action:string,input:Record<string,unknown>):Promise<void>{
    if(!await moduleEnabled(this.db,guildId,"music",false)) throw new Error("music_disabled");
    if(!this.ready) throw new Error("music_unavailable");
    let s=this.sessions.get(guildId);

    if(action==="play"){
      const voiceChannelId=String(input.voiceChannelId??""); if(!voiceChannelId) throw new Error("voice_channel_required");
      const guild=this.client?.guilds.cache.get(guildId), channel=guild?.channels.cache.get(voiceChannelId);
      if(!guild||!channel?.isVoiceBased()) throw new Error("voice_channel_required");
      await this.assertOwnership(guildId,voiceChannelId);
      s??=await this.createSession(guild,voiceChannelId);
      if(s.voiceChannelId!==voiceChannelId) throw new Error("music_player_in_other_voice");
      const query=String(input.query??"").trim(); if(!query) throw new Error("music_query_required");
      const provider=normalizeMusicSearchProvider(String(input.provider??"auto")); if(!provider) throw new Error("invalid_music_provider");
      s.queue.push(...await this.search(query,provider,MAX_MUSIC_ENQUEUE_TRACKS));
      if(!s.current) await this.playNext(s);
    } else {
      if(!s) throw new Error("music_player_not_started");
      if(action==="pause") await this.pause(s);
      else if(action==="resume") await this.resume(s);
      else if(action==="skip") await this.skip(s);
      else if(action==="stop") await this.stop(s);
      else if(action==="shuffle"){if(s.queue.length<2)throw new Error("music_queue_too_short");shuffle(s.queue);}
      else if(action==="repeat") s.repeatMode=normalizeMusicRepeatMode(String(input.mode??""))??(()=>{throw new Error("invalid_repeat_mode");})();
      else if(action==="seek"){const sec=Number(input.value);if(!s.current||!Number.isInteger(sec)||sec<0||sec*1000>=s.current.durationMs&&s.current.durationMs>0)throw new Error("invalid_seek");await this.start(s,sec*1000,s.paused);}
      else if(action==="volume"){const v=Number(input.value);if(!Number.isInteger(v)||v<0||v>200)throw new Error("invalid_volume");s.volume=v;s.resource?.volume?.setVolume(v/100);}
      else if(action==="autoplay"){if(typeof input.enabled!=="boolean")throw new Error("invalid_autoplay");s.autoplay=input.enabled;await this.setAutoplay(guildId,input.enabled);}
      else if(action==="remove"){const p=normalizeMusicQueuePosition(Number(input.value),s.queue.length);if(p===null)throw new Error("invalid_queue_position");s.queue.splice(p,1);}
      else if(action==="move"){const m=normalizeMusicQueueMove(Number(input.from),Number(input.to),s.queue.length);if(!m)throw new Error("invalid_queue_move");const [t]=s.queue.splice(m.from,1);s.queue.splice(m.to,0,t!);}
      else if(action==="clear")s.queue.length=0;
      else if(action==="filter"){const f=normalizeMusicFilterPreset(String(input.filter??""));if(!f)throw new Error("invalid_music_filter");s.filter=f;if(s.current)await this.start(s,this.position(s),s.paused);}
    }
    if(s){await this.persist(s);await this.controller(s);}
  }

  async executeSlashCommand(i:ChatInputCommandInteraction,commandName=i.commandName):Promise<void>{
    if(!i.inGuild())return;
    const aliases=new Set(["play","pause","resume","skip","stop","shuffle","playlist","queue","repeat","seek","volume","autoplay","nowplaying"]);
    if(commandName!=="music"&&!aliases.has(commandName))return;
    if(!await moduleEnabled(this.db,i.guildId!,"music",false)){await i.reply({content:"Модуль Music выключен.",ephemeral:true});return;}
    if(!this.ready){await i.reply({content:"Музыка недоступна: проверь yt-dlp и ffmpeg.",ephemeral:true});return;}
    try{
      const action=commandName==="music"?i.options.getSubcommand():commandName;
      const guild=i.guild!, existing=this.sessions.get(guild.id), memberVoice=guild.voiceStates.cache.get(i.user.id)?.channelId??null;
      if(!await this.ownershipForInteraction(i,memberVoice??existing?.voiceChannelId??null))return;

      if(action==="play"){
        if(!memberVoice)throw new Error("voice_channel_required");
        const query=i.options.getString("query",true).trim();
        const provider=normalizeMusicSearchProvider(i.options.getString("provider")??"auto");if(!provider)throw new Error("invalid_music_provider");
        await this.assertOwnership(guild.id,memberVoice);
        const s=existing??await this.createSession(guild,memberVoice);
        s.queue.push(...await this.search(query,provider,MAX_MUSIC_ENQUEUE_TRACKS));if(!s.current)await this.playNext(s);
        await this.persist(s);await i.reply({content:"🎵 Добавлено в очередь."});return;
      }

      const s=this.sessions.get(guild.id);if(!s){await i.reply({content:"Музыка не запущена.",ephemeral:true});return;}
      if(!await this.canControl(i,s.voiceChannelId))return;
      if(action==="pause")await this.pause(s);
      else if(action==="resume")await this.resume(s);
      else if(action==="skip")await this.skip(s);
      else if(action==="stop")await this.stop(s);
      else if(action==="shuffle"){if(s.queue.length<2)throw new Error("music_queue_too_short");shuffle(s.queue);}
      else if(action==="queue"||action==="playlist"){const rows=s.queue.slice(0,15).map((t,n)=>`${n+1}. ${t.title} — ${t.author}`);await i.reply({content:rows.length?"🎵 Очередь:\n"+rows.join("\n"):"🎵 Очередь пуста.",ephemeral:true});return;}
      else if(action==="nowplaying"){await i.reply({content:s.current?`🎵 **${s.current.title}** — ${s.current.author}\n${formatDuration(this.position(s))} / ${formatDuration(s.current.durationMs)}`:"Сейчас ничего не играет.",ephemeral:true});return;}
      else if(action==="repeat")s.repeatMode=normalizeMusicRepeatMode(i.options.getString("mode",true))??(()=>{throw new Error("invalid_repeat_mode");})();
      else if(action==="seek"){const sec=i.options.getInteger("seconds",true);if(!s.current||(s.current.durationMs>0&&sec*1000>=s.current.durationMs))throw new Error("invalid_seek");await this.start(s,sec*1000,s.paused);}
      else if(action==="volume"){const v=i.options.getInteger("value");if(v===null){await i.reply({content:`Громкость: **${s.volume}**.`,ephemeral:true});return;}s.volume=v;s.resource?.volume?.setVolume(v/100);}
      else if(action==="autoplay"){const v=i.options.getBoolean("enabled");if(v===null){await i.reply({content:`Autoplay: **${s.autoplay?"on":"off"}**.`,ephemeral:true});return;}s.autoplay=v;await this.setAutoplay(s.guildId,v);}
      else return;
      await this.persist(s);await this.controller(s);await i.reply({content:"✅ Готово.",ephemeral:true});
    }catch(error){if(!i.replied&&!i.deferred)await i.reply({content:formatError(error),ephemeral:true}).catch(()=>undefined);}
  }

  async handlePrefixCommand(message:Message,commandName:string,args:string[]):Promise<boolean>{
    if(!message.guild||!BUILTIN_MUSIC_COMMANDS.has(commandName))return false;
    if(!await moduleEnabled(this.db,message.guild.id,"music",false)){await message.reply("Модуль Music выключен.");return true;}
    if(!this.ready){await message.reply("Музыка недоступна: проверь yt-dlp и ffmpeg.");return true;}
    try{
      const member=message.member??await message.guild.members.fetch(message.author.id).catch(()=>null), voice=member?.voice.channelId??null;
      if(commandName==="play"||commandName==="music"){
        if(!voice)throw new Error("voice_channel_required");const query=args.join(" ").trim();if(!query)throw new Error("music_query_required");
        await this.assertOwnership(message.guild.id,voice);const s=this.sessions.get(message.guild.id)??await this.createSession(message.guild,voice);
        if(!s.textChannelId&&message.channel.isTextBased())s.textChannelId=message.channel.id;
        s.queue.push(...await this.search(query,"auto",MAX_MUSIC_ENQUEUE_TRACKS));if(!s.current)await this.playNext(s);await this.persist(s);await this.controller(s);await message.reply("🎵 Добавлено в очередь.");return true;
      }
      const s=this.sessions.get(message.guild.id);if(!s){await message.reply("Музыка не запущена.");return true;}
      const elevated=Boolean(member?.permissions.has("ManageGuild"))||await this.hasDj(message.guild.id,member);
      if(!canControlMusic(voice,s.voiceChannelId,elevated)){await message.reply("Управлять музыкой можно из того же voice-канала, с DJ-ролью или с Manage Server.");return true;}
      if(commandName==="pause")await this.pause(s);
      else if(commandName==="resume")await this.resume(s);
      else if(commandName==="skip")await this.skip(s);
      else if(commandName==="stop")await this.stop(s);
      else if(commandName==="shuffle")shuffle(s.queue);
      else if(commandName==="queue"||commandName==="playlist"){const rows=s.queue.slice(0,15).map((t,n)=>`${n+1}. ${t.title} — ${t.author}`);await message.reply(rows.length?"🎵 Очередь:\n"+rows.join("\n"):"🎵 Очередь пуста.");return true;}
      else if(commandName==="nowplaying"){await message.reply(s.current?`🎵 **${s.current.title}** — ${s.current.author} · ${formatDuration(this.position(s))}/${formatDuration(s.current.durationMs)}`:"Сейчас ничего не играет.");return true;}
      else if(commandName==="repeat")s.repeatMode=normalizeMusicRepeatMode((args[0]??"").toLowerCase())??(()=>{throw new Error("invalid_repeat_mode");})();
      else if(commandName==="seek"){const sec=Number(args[0]??"");if(!s.current||!Number.isInteger(sec)||sec<0)throw new Error("invalid_seek");await this.start(s,sec*1000,s.paused);}
      else if(commandName==="volume"){const v=Number(args[0]??"");if(!Number.isInteger(v)||v<0||v>200)throw new Error("invalid_volume");s.volume=v;s.resource?.volume?.setVolume(v/100);}
      else if(commandName==="autoplay"){const v=String(args[0]??"").toLowerCase();if(v!=="on"&&v!=="off")throw new Error("invalid_autoplay");s.autoplay=v==="on";await this.setAutoplay(s.guildId,s.autoplay);}
      if(!s.textChannelId&&message.channel.isTextBased())s.textChannelId=message.channel.id;
      await this.persist(s);await this.controller(s);return true;
    }catch(error){await message.reply(formatError(error)).catch(()=>undefined);return true;}
  }

  async onInteraction(i:Interaction):Promise<void>{
    if(!i.isButton()||!i.customId.startsWith("dsp:music:")||!i.guild)return;
    await i.deferUpdate().catch(()=>undefined);
    const s=this.sessions.get(i.guild.id);
    if(!s){await i.followUp({content:"Музыка не запущена.",ephemeral:true}).catch(()=>undefined);return;}
    const member=await i.guild.members.fetch(i.user.id).catch(()=>null), elevated=Boolean(member?.permissions.has("ManageGuild"))||await this.hasDj(i.guild.id,member);
    if(!canControlMusic(member?.voice.channelId??null,s.voiceChannelId,elevated)){
      await i.followUp({content:"Управлять музыкой можно из того же voice-канала, с DJ-ролью или с Manage Server.",ephemeral:true}).catch(()=>undefined);
      return;
    }
    try{
      const a=i.customId.slice("dsp:music:".length);
      if(a==="pause")s.paused?await this.resume(s):await this.pause(s);
      else if(a==="skip")await this.skip(s);
      else if(a==="stop")await this.stop(s);
      else if(a==="shuffle"){if(s.queue.length<2)throw new Error("music_queue_too_short");shuffle(s.queue);}
      else if(a==="repeat")s.repeatMode=nextMusicRepeatMode(s.repeatMode);
      else if(a==="volume_down"||a==="volume_up"){s.volume=adjustMusicVolume(s.volume,a==="volume_down"?-10:10);s.resource?.volume?.setVolume(s.volume/100);}
      else return;
      await this.persist(s);
      await this.controller(s);
    }catch(error){
      await i.followUp({content:formatError(error),ephemeral:true}).catch(()=>undefined);
    }
  }

  private async createSession(guild:Guild,voiceChannelId:string):Promise<Session>{
    const channel=guild.channels.cache.get(voiceChannelId);if(!channel?.isVoiceBased())throw new Error("voice_channel_required");
    const connection=joinVoiceChannel({channelId:voiceChannelId,guildId:guild.id,adapterCreator:guild.voiceAdapterCreator,selfDeaf:true});
    try{await entersState(connection,VoiceConnectionStatus.Ready,15000);}catch{connection.destroy();throw new Error("music_voice_connection_failed");}
    const player=createAudioPlayer({behaviors:{noSubscriber:NoSubscriberBehavior.Pause}});connection.subscribe(player);
    const st=await this.musicSettings(guild.id);
    const s:Session={guildId:guild.id,voiceChannelId,textChannelId:st.preferredTextChannelId,player,connection,queue:[],current:null,positionMs:0,positionChangedAt:Date.now(),paused:false,volume:st.defaultVolume,repeatMode:"off",autoplay:st.autoplay,filter:"off",ffmpeg:null,resource:null,intentionalStop:false,transitioning:false,controllerMessageId:null,autoLeaveTimer:null};
    player.on(AudioPlayerStatus.Idle,()=>void this.idle(s));
    connection.on("stateChange",(_o,state)=>{if(state.status===VoiceConnectionStatus.Disconnected)setTimeout(()=>{if(this.sessions.get(s.guildId)!==s||s.connection.state.status!==VoiceConnectionStatus.Disconnected)return;logger.info("Music voice rejoin requested",{guildId:s.guildId,rejoined:s.connection.rejoin()});},1000).unref();});
    this.sessions.set(guild.id,s);await this.persist(s);return s;
  }

  private async playNext(s:Session):Promise<void>{
    for(let n=0;n<10&&!s.current&&s.queue.length;n++){s.current=s.queue.shift()??null;if(!s.current)break;try{await this.start(s,0,false);return;}catch(error){logger.warn("Music track skipped after start failure",{guildId:s.guildId,trackId:s.current.id,error:String(error)});s.current=null;}}
    if(!s.current&&!s.queue.length)this.scheduleLeave(s);
  }

  private async start(s:Session,offsetMs:number,paused:boolean):Promise<void>{
    if(!s.current)throw new Error("music_player_not_started");s.transitioning=true;
    try{
      s.intentionalStop=true;s.player.stop(true);this.killFfmpeg(s);s.intentionalStop=false;
      const direct=await this.resolve(s.current);
      const ffmpeg=spawn(this.config.ffmpegPath,buildFfmpegArgs(direct,offsetMs,s.filter),{windowsHide:true,stdio:["pipe","pipe","pipe"]});s.ffmpeg=ffmpeg;
      const resource=createAudioResource(ffmpeg.stdout,{inputType:StreamType.Raw,inlineVolume:true,metadata:s.current});resource.volume?.setVolume(s.volume/100);
      s.resource=resource;s.positionMs=Math.max(0,offsetMs);s.positionChangedAt=Date.now();s.paused=paused;
      ffmpeg.stderr.on("data",chunk=>{const msg=String(chunk).trim();if(msg)logger.info("Music ffmpeg",{guildId:s.guildId,message:msg.slice(-400)});});
      ffmpeg.once("exit",(code,signal)=>{if(s.ffmpeg===ffmpeg)s.ffmpeg=null;if((code??0)!==0&&!s.intentionalStop)logger.warn("Music ffmpeg exited unexpectedly",{guildId:s.guildId,code,signal});});
      s.player.play(resource);if(paused)s.player.pause();await this.persist(s);await this.controller(s);
      const st=await this.musicSettings(s.guildId);if(st.announceTrackStart&&s.textChannelId)await this.announce(s.textChannelId,`🎵 Сейчас играет: **${s.current.title}** — ${s.current.author}`);
    }finally{s.transitioning=false;}
  }

  private async idle(s:Session):Promise<void>{
    if(s.intentionalStop||s.transitioning||!s.current)return;
    const previous=s.current;s.intentionalStop=true;s.player.stop(true);this.killFfmpeg(s);s.intentionalStop=false;
    if(s.repeatMode==="track")s.current=previous;else{if(s.repeatMode==="queue")s.queue.push(previous);s.current=s.queue.shift()??null;s.positionMs=0;}
    if(!s.current&&s.autoplay){const related=await this.search(`${previous.author} ${previous.title}`,"auto",5).catch(()=>[]);s.current=related.find(t=>t.id!==previous.id)??null;}
    if(s.current)await this.start(s,0,false);else this.scheduleLeave(s);await this.persist(s);await this.controller(s);
  }

  private async pause(s:Session):Promise<void>{if(!s.current)throw new Error("music_player_not_started");s.positionMs=this.position(s);s.paused=true;s.player.pause();}
  private async resume(s:Session):Promise<void>{if(!s.current)throw new Error("music_player_not_started");s.paused=false;s.positionChangedAt=Date.now();s.player.unpause();}
  private async skip(s:Session):Promise<void>{if(!s.current)throw new Error("music_player_not_started");if(s.transitioning)return;s.transitioning=true;try{s.intentionalStop=true;s.player.stop(true);this.killFfmpeg(s);s.intentionalStop=false;s.current=s.queue.shift()??null;s.positionMs=0;if(s.current)await this.start(s,0,false);else this.scheduleLeave(s);}finally{s.transitioning=false;}}
  private async stop(s:Session):Promise<void>{s.intentionalStop=true;s.player.stop(true);this.killFfmpeg(s);s.queue.length=0;s.current=null;s.positionMs=0;s.paused=false;this.cancelLeave(s);}

  private position(s:Session):number{return s.current?musicResumePosition(s.positionMs,s.positionChangedAt,s.paused,s.current.durationMs,Date.now()):0;}

  private async search(query:string,provider:MusicSearchProvider,limit:number):Promise<MusicTrack[]>{
    const q=query.trim();if(!q)return[];
    const detected=detectMusicSearchProvider(q);
    if(detected==="spotify"){
      return await this.searchSpotify(q,limit);
    }
    const target=buildMusicSearchTarget(provider,q,limit);
    if(!target){
      throw new Error("music_provider_requires_url");
    }
    const r=await runProcess(this.config.ytDlpPath,[...this.ytArgs(),"--dump-single-json","--flat-playlist","--skip-download",target],45000);
    if(r.code!==0){logger.warn("yt-dlp search failed",{provider,query:q.slice(0,200),stderr:r.stderr.slice(-800)});throw new Error("music_search_failed");}
    let data:any;try{data=JSON.parse(r.stdout);}catch{throw new Error("music_search_failed");}
    const raw=Array.isArray(data.entries)?data.entries:[data];
    return raw.map((e:any,n:number)=>normalizeYtDlpEntry(e,n,isHttpUrl(q)?q:undefined)).filter((x:any):x is MusicTrack=>Boolean(x)).slice(0,limit);
  }

  private async searchSpotify(url:string,limit:number):Promise<MusicTrack[]>{
    if(!/\/track\//i.test(url))throw new Error("music_spotify_track_only");
    try{
      const endpoint=`https://open.spotify.com/oembed?url=${encodeURIComponent(url)}`;
      const response=await fetch(endpoint,{headers:{"user-agent":"Discord-Server-Platform Music/1.0"},signal:AbortSignal.timeout(15000)});
      if(!response.ok)throw new Error(`Spotify oEmbed HTTP ${response.status}`);
      const data=await response.json() as {title?:unknown;author_name?:unknown};
      const title=String(data.title??"").trim();
      const author=String(data.author_name??"").trim();
      if(!title)return[];
      const query=[author,title].filter(Boolean).join(" ");
      const target=`ytsearch${Math.min(Math.max(limit,1),MAX_MUSIC_ENQUEUE_TRACKS)}:${query}`;
      const r=await runProcess(this.config.ytDlpPath,[...this.ytArgs(),"--dump-single-json","--flat-playlist","--skip-download",target],45000);
      if(r.code!==0){logger.warn("Spotify metadata bridge search failed",{query:query.slice(0,200),stderr:r.stderr.slice(-800)});throw new Error("music_search_failed");}
      let parsed:any;try{parsed=JSON.parse(r.stdout);}catch{throw new Error("music_search_failed");}
      const raw=Array.isArray(parsed.entries)?parsed.entries:[parsed];
      logger.info("Spotify metadata bridge resolved track",{title,author});
      return raw.map((e:any,n:number)=>normalizeYtDlpEntry(e,n)).filter((x:any):x is MusicTrack=>Boolean(x)).slice(0,limit);
    }catch(error){
      if(error instanceof Error && error.message.startsWith("music_"))throw error;
      logger.warn("Spotify metadata bridge failed",{url,error:String(error)});
      throw new Error("music_search_failed");
    }
  }

  private async resolve(track:MusicTrack):Promise<string>{
    const r=await runProcess(this.config.ytDlpPath,[...this.ytArgs(),"--no-playlist","-f","bestaudio/best","-g",track.url],45000);
    if(r.code!==0)throw new Error("music_stream_resolve_failed");const url=r.stdout.split(/\r?\n/).map(x=>x.trim()).find(Boolean);if(!url)throw new Error("music_stream_resolve_failed");return url;
  }

  private ytArgs():string[]{const a=["--ignore-config","--no-warnings","--no-update","--js-runtimes",this.config.ytDlpJsRuntime];if(this.config.ytDlpCookiesFile)a.push("--cookies",this.config.ytDlpCookiesFile);return a;}

  private async verifyTooling():Promise<boolean>{
    const [a,b]=await Promise.all([runProcess(this.config.ytDlpPath,["--version"],10000),runProcess(this.config.ffmpegPath,["-version"],10000)]);
    logger.info("Music tooling check",{ytDlp:a.code===0?a.stdout.trim().split(/\r?\n/)[0]:"unavailable",ffmpeg:b.code===0?b.stdout.trim().split(/\r?\n/)[0]:"unavailable"});
    return a.code===0&&b.code===0;
  }

  private async restore():Promise<void>{
    if(!this.client||!this.ready)return;
    const r=await this.db.query<any>("SELECT p.guild_id,p.voice_channel_id,p.text_channel_id,p.state,p.controller_message_id,q.data AS queue_data FROM music_players p LEFT JOIN music_queue_store q ON q.guild_id=p.guild_id AND q.bot_identity_id=p.bot_identity_id WHERE p.bot_identity_id=$1",[this.config.botIdentityId]);
    for(const row of r.rows){try{
      if(!row.voice_channel_id)continue;const guild=this.client.guilds.cache.get(row.guild_id),channel=guild?.channels.cache.get(row.voice_channel_id);if(!guild||!channel?.isVoiceBased())continue;
      if(this.config.botIdentityId!=="primary"&&await this.identities.musicVoiceOwner(guild.id,row.voice_channel_id).catch(()=>null)!==this.config.botIdentityId)continue;
      const s=await this.createSession(guild,row.voice_channel_id);s.textChannelId=row.text_channel_id;s.controllerMessageId=row.controller_message_id;
      const st=normalizePersistedMusicState(row.state);s.queue.push(...extractQueue(row.queue_data));s.volume=st.volume;s.repeatMode=st.repeatMode;s.filter=st.filter;s.autoplay=await this.getAutoplay(guild.id);
      if(st.track){s.current=st.track;await this.start(s,st.positionMs,st.paused);}else if(s.queue.length)await this.playNext(s);await this.persist(s);
    }catch(error){logger.warn("Music restore failed",{guildId:row.guild_id,error:String(error)});}}
  }

  private async persist(s:Session):Promise<void>{
    try{
      await this.db.query("INSERT INTO music_players(guild_id,bot_identity_id,voice_channel_id,text_channel_id,state) VALUES($1,$2,$3,$4,$5::jsonb) ON CONFLICT(guild_id,bot_identity_id) DO UPDATE SET voice_channel_id=EXCLUDED.voice_channel_id,text_channel_id=EXCLUDED.text_channel_id,state=EXCLUDED.state,updated_at=now()",[s.guildId,this.config.botIdentityId,s.voiceChannelId,s.textChannelId,JSON.stringify({engine:"yt-dlp-ffmpeg",track:s.current,paused:s.paused,positionMs:this.position(s),volume:s.volume,repeatMode:s.repeatMode,filter:s.filter})]);
      await this.db.query("INSERT INTO music_queue_store(guild_id,bot_identity_id,data) VALUES($1,$2,$3::jsonb) ON CONFLICT(guild_id,bot_identity_id) DO UPDATE SET data=EXCLUDED.data,updated_at=now()",[s.guildId,this.config.botIdentityId,JSON.stringify({tracks:s.queue})]);
    }catch(error){logger.warn("Music state persistence failed",{guildId:s.guildId,error:String(error)});}
  }

  private async controller(s:Session):Promise<void>{
    if(!this.client||!s.textChannelId)return;const channel=this.client.channels.cache.get(s.textChannelId);if(!channel?.isTextBased()||!("send"in channel))return;
    const repeatText=s.repeatMode==="off"?"выкл.":s.repeatMode==="track"?"трек":"очередь"; const embed=new EmbedBuilder().setTitle("🎵 Music").setDescription(s.current?`**${s.current.title}**\n${s.current.author}`:"Сейчас ничего не играет.").addFields({name:"Состояние",value:s.paused?"⏸ Пауза":"▶ Играет",inline:true},{name:"Повтор",value:repeatText,inline:true},{name:"Громкость",value:String(s.volume),inline:true}).setTimestamp();
    const components=buildController(s.paused,s.repeatMode), existing=s.controllerMessageId?await channel.messages.fetch(s.controllerMessageId).catch(()=>null):null;
    if(existing){await existing.edit({embeds:[embed],components}).catch(()=>undefined);return;}
    const sent=await channel.send({embeds:[embed],components}).catch(()=>null);if(sent){s.controllerMessageId=sent.id;await this.db.query("UPDATE music_players SET controller_message_id=$1,updated_at=now() WHERE guild_id=$2 AND bot_identity_id=$3",[sent.id,s.guildId,this.config.botIdentityId]).catch(()=>undefined);}
  }

  private async announce(channelId:string,text:string){const c=this.client?.channels.cache.get(channelId);if(c?.isTextBased()&&"send"in c)await c.send(text).catch(()=>undefined);}
  private async musicSettings(guildId:string){const r=await this.db.query<any>("SELECT preferred_text_channel_id,default_volume,announce_track_start,autoplay,auto_leave_seconds FROM music_settings WHERE guild_id=$1",[guildId]);const row=r.rows[0];return{preferredTextChannelId:row?.preferred_text_channel_id??null,defaultVolume:Math.min(200,Math.max(0,Number(row?.default_volume??100))),announceTrackStart:row?.announce_track_start??true,autoplay:row?.autoplay??false,autoLeaveSeconds:Math.min(86400,Math.max(0,Number(row?.auto_leave_seconds??30)))};}
  private async getAutoplay(guildId:string){return(await this.musicSettings(guildId)).autoplay;}
  private async setAutoplay(guildId:string,value:boolean){await this.db.query("INSERT INTO music_settings(guild_id,autoplay) VALUES($1,$2) ON CONFLICT(guild_id) DO UPDATE SET autoplay=EXCLUDED.autoplay,updated_at=now()",[guildId,value]);}
  private async hasDj(guildId:string,member:GuildMember|null){if(!member)return false;if(member.permissions.has("ManageGuild"))return true;const r=await this.db.query<{dj_role_id:string|null}>("SELECT dj_role_id FROM guild_settings WHERE guild_id=$1",[guildId]);const role=r.rows[0]?.dj_role_id??null;return Boolean(role&&member.roles.cache.has(role));}
  private async canControl(i:ChatInputCommandInteraction,voice:string){const m=i.guild?await i.guild.members.fetch(i.user.id).catch(()=>null):null;const allowed=canControlMusic(m?.voice.channelId??null,voice,Boolean(i.memberPermissions?.has("ManageGuild"))||await this.hasDj(i.guildId!,m));if(!allowed)await i.reply({content:"Управлять музыкой можно из того же voice-канала, с DJ-ролью или с Manage Server.",ephemeral:true});return allowed;}
  private async ownershipForInteraction(i:ChatInputCommandInteraction,voice:string|null){if(!voice)return this.config.botIdentityId==="primary"||Boolean((await this.identities.listMusicAssignments(i.guildId!)).find(a=>a.botIdentityId===this.config.botIdentityId));try{await this.assertOwnership(i.guildId!,voice);return true;}catch(e){await i.reply({content:formatError(e),ephemeral:true}).catch(()=>undefined);return false;}}
  private async assertOwnership(guildId:string,voice:string){const owner=await this.identities.musicVoiceOwner(guildId,voice);if(owner&&owner!==this.config.botIdentityId)throw new Error("music_voice_assigned_elsewhere");if(!owner&&this.config.botIdentityId!=="primary")throw new Error("music_voice_not_assigned");}
  private scheduleLeave(s:Session){this.cancelLeave(s);void this.musicSettings(s.guildId).then(st=>{if(st.autoLeaveSeconds<=0)return;s.autoLeaveTimer=setTimeout(()=>{if(s.current||s.queue.length)return;s.intentionalStop=true;s.player.stop(true);this.killFfmpeg(s);s.connection.destroy();this.sessions.delete(s.guildId);void this.db.query("DELETE FROM music_players WHERE guild_id=$1 AND bot_identity_id=$2",[s.guildId,this.config.botIdentityId]);void this.db.query("DELETE FROM music_queue_store WHERE guild_id=$1 AND bot_identity_id=$2",[s.guildId,this.config.botIdentityId]);},st.autoLeaveSeconds*1000).unref();}).catch(()=>undefined);}
  private cancelLeave(s:Session){if(s.autoLeaveTimer)clearTimeout(s.autoLeaveTimer);s.autoLeaveTimer=null;}
  private killFfmpeg(s:Session){const p=s.ffmpeg;s.ffmpeg=null;s.resource=null;if(p)try{p.kill("SIGKILL");}catch{}}
  private async destroy(s:Session,remove:boolean){this.cancelLeave(s);s.intentionalStop=true;s.player.stop(true);this.killFfmpeg(s);s.connection.destroy();if(remove){await this.db.query("DELETE FROM music_players WHERE guild_id=$1 AND bot_identity_id=$2",[s.guildId,this.config.botIdentityId]).catch(()=>undefined);await this.db.query("DELETE FROM music_queue_store WHERE guild_id=$1 AND bot_identity_id=$2",[s.guildId,this.config.botIdentityId]).catch(()=>undefined);}}
}

export const BUILTIN_MUSIC_COMMANDS=new Set(["music","play","pause","resume","skip","stop","shuffle","playlist","queue","nowplaying","repeat","seek","volume","autoplay"]);

export function normalizeMusicSearchProvider(v:string):MusicSearchProvider|null{
  const x=v.trim().toLowerCase();
  return ["auto","youtube","tiktok","yandex_music","vk_music","spotify","soundcloud"].includes(x)?x as MusicSearchProvider:null;
}
export function buildMusicSearchTarget(provider:MusicSearchProvider,query:string,limit=1):string|null{
  const q=query.trim();if(!q)return null;
  if(/^https?:\/\//i.test(q))return q;
  const n=Math.min(Math.max(Number.isInteger(limit)?limit:1,1),MAX_MUSIC_ENQUEUE_TRACKS);
  if(provider==="auto"||provider==="youtube")return `ytsearch${n}:${q}`;
  if(provider==="soundcloud")return `scsearch${n}:${q}`;
  return null;
}
export function detectMusicSearchProvider(url:string):MusicSearchProvider|null{
  if(!isHttpUrl(url))return null;
  try{
    const host=new URL(url).hostname.toLowerCase();
    if(host==="spotify.com"||host.endsWith(".spotify.com"))return "spotify";
    if(host==="tiktok.com"||host.endsWith(".tiktok.com"))return "tiktok";
    if(host==="music.yandex.ru"||host==="music.yandex.com"||host.endsWith(".music.yandex.ru")||host.endsWith(".music.yandex.com"))return "yandex_music";
    if(host==="vk.com"||host.endsWith(".vk.com")||host==="vkvideo.ru"||host.endsWith(".vkvideo.ru"))return "vk_music";
    if(host==="soundcloud.com"||host.endsWith(".soundcloud.com"))return "soundcloud";
    if(host==="youtube.com"||host.endsWith(".youtube.com")||host==="youtu.be")return "youtube";
  }catch{}
  return "auto";
}
export function normalizeYtDlpEntry(e:any,index=0,fallbackUrl?:string):MusicTrack|null{
  if(!e||typeof e!=="object")return null;
  const id=String(e.id??e.url??"").trim();if(!id)return null;
  const explicitUrl=String(e.webpage_url??e.original_url??"").trim();
  const entryUrl=/^https?:\/\//i.test(explicitUrl)?explicitUrl:/^https?:\/\//i.test(String(e.url??""))?String(e.url).trim():"";
  const url=entryUrl||fallbackUrl||`https://www.youtube.com/watch?v=${encodeURIComponent(id)}`;
  if(!url)return null;
  return{id,title:String(e.title??`Track ${index+1}`),author:String(e.uploader??e.channel??e.artist??"Unknown artist"),durationMs:Math.max(0,Math.trunc(Number(e.duration??0)*1000)),url};
}
function isHttpUrl(value:string):boolean{return /^https?:\/\//i.test(value.trim());}
export function normalizeMusicFilterPreset(v:string):MusicFilterPreset|null{const x=v.trim().toLowerCase();return["off","nightcore","vaporwave","karaoke","rotation","tremolo","vibrato","lowpass"].includes(x)?x as MusicFilterPreset:null;}
export function buildFfmpegFilter(p:MusicFilterPreset):string|null{if(p==="nightcore")return"asetrate=48000*1.25,aresample=48000,atempo=0.8";if(p==="vaporwave")return"asetrate=48000*0.8,aresample=48000,atempo=1.25";if(p==="karaoke")return"stereotools=mlev=0";if(p==="rotation")return"apulsator=hz=0.08";if(p==="tremolo")return"tremolo=f=5:d=0.5";if(p==="vibrato")return"vibrato=f=5:d=0.5";if(p==="lowpass")return"lowpass=f=12000";return null;}
export function buildFfmpegArgs(url:string,offsetMs=0,filter:MusicFilterPreset="off"):string[]{const a=["-hide_banner","-loglevel","warning","-nostdin","-reconnect","1","-reconnect_streamed","1","-reconnect_delay_max","5"];if(offsetMs>0)a.push("-ss",String(offsetMs/1000));a.push("-i",url,"-vn");const f=buildFfmpegFilter(filter);if(f)a.push("-af",f);a.push("-f","s16le","-ar","48000","-ac","2","pipe:1");return a;}
export function adjustMusicVolume(v:number,d:number):number{const n=Number.isFinite(v)?Math.trunc(v):100;const x=Number.isFinite(d)?Math.trunc(d):0;return Math.min(200,Math.max(0,n+x));}
export function musicResumePosition(p:number,s:number,paused:boolean,durationMs=0,nowMs=Date.now()):number{const base=Number.isFinite(p)&&p>=0?p:0;const snap=Number.isFinite(s)&&s>=0?s:nowMs;const value=paused?base:base+Math.max(0,nowMs-snap);return durationMs>0?Math.min(value,Math.max(0,durationMs-1000)):value;}
export function canControlMusic(memberVoiceChannelId:string|null,playerVoiceChannelId:string|null,elevated:boolean):boolean{return elevated||Boolean(memberVoiceChannelId&&playerVoiceChannelId&&memberVoiceChannelId===playerVoiceChannelId);}
export function normalizeMusicRepeatMode(v:string):MusicRepeatMode|null{return v==="off"||v==="track"||v==="queue"?v:null;}
export function nextMusicRepeatMode(v:MusicRepeatMode):MusicRepeatMode{return v==="off"?"track":v==="track"?"queue":"off";}
export function shouldAutoplayAfterQueueEnd(a:boolean,r:MusicRepeatMode,n:number):boolean{return a&&r==="off"&&n===0;}
export function normalizeMusicQueuePosition(v:number,n:number):number|null{if(!Number.isInteger(v)||!Number.isInteger(n)||n<1||v<1||v>n)return null;return v-1;}
export function normalizeMusicQueueMove(f:number,t:number,n:number):{from:number;to:number}|null{const a=normalizeMusicQueuePosition(f,n),b=normalizeMusicQueuePosition(t,n);return a===null||b===null||a===b?null:{from:a,to:b};}
export function musicPlayerNodeId(available:boolean):string|null{return available?"local":null;}

function extractQueue(input:unknown):MusicTrack[]{if(!input||typeof input!=="object")return[];const raw=Array.isArray((input as any).tracks)?(input as any).tracks:[];return raw.map((x:any)=>coerceTrack(x)).filter((x:any):x is MusicTrack=>Boolean(x)).slice(0,MAX_MUSIC_ENQUEUE_TRACKS);}
function coerceTrack(x:any):MusicTrack|null{if(!x||typeof x!=="object")return null;if(typeof x.id==="string"&&typeof x.url==="string"&&typeof x.title==="string")return{id:x.id,url:x.url,title:x.title,author:String(x.author??"Unknown artist"),durationMs:Number(x.durationMs??0)};const info=x.info;if(!info||typeof info!=="object"||!info.identifier||!info.title)return null;return{id:String(info.identifier),title:String(info.title),author:String(info.author??"Unknown artist"),durationMs:Number(info.duration??0),url:`https://www.youtube.com/watch?v=${info.identifier}`};}
function normalizePersistedMusicState(x:unknown){const s=x&&typeof x==="object"?x as any:{};return{track:coerceTrack(s.track),paused:s.paused===true,positionMs:Number.isFinite(Number(s.positionMs))?Math.max(0,Number(s.positionMs)):0,volume:Math.min(200,Math.max(0,Number(s.volume??100))),repeatMode:normalizeMusicRepeatMode(String(s.repeatMode??""))??"off" as MusicRepeatMode,filter:normalizeMusicFilterPreset(String(s.filter??""))??"off" as MusicFilterPreset};}
function buildController(paused:boolean,repeatMode:MusicRepeatMode){
  const repeatLabel=repeatMode==="off"?"выкл.":repeatMode==="track"?"трек":"очередь";
  return [
    new ActionRowBuilder<ButtonBuilder>().addComponents(
      new ButtonBuilder().setCustomId("dsp:music:pause").setEmoji(paused?"▶️":"⏸️").setStyle(ButtonStyle.Primary),
      new ButtonBuilder().setCustomId("dsp:music:skip").setEmoji("⏭️").setStyle(ButtonStyle.Secondary),
      new ButtonBuilder().setCustomId("dsp:music:shuffle").setEmoji("🔀").setStyle(ButtonStyle.Secondary),
      new ButtonBuilder().setCustomId("dsp:music:repeat").setLabel(`Повтор: ${repeatLabel}`).setEmoji(repeatMode==="queue"?"🔁":"🔂").setStyle(ButtonStyle.Secondary),
      new ButtonBuilder().setCustomId("dsp:music:stop").setEmoji("⏹️").setStyle(ButtonStyle.Danger)
    ),
    new ActionRowBuilder<ButtonBuilder>().addComponents(
      new ButtonBuilder().setCustomId("dsp:music:volume_down").setLabel("-10").setEmoji("🔉").setStyle(ButtonStyle.Secondary),
      new ButtonBuilder().setCustomId("dsp:music:volume_up").setLabel("+10").setEmoji("🔊").setStyle(ButtonStyle.Secondary)
    )
  ];
}
function shuffle<T>(items:T[]):void{for(let i=items.length-1;i>0;i--){const j=Math.floor(Math.random()*(i+1));[items[i],items[j]]=[items[j]!,items[i]!];}}
function formatDuration(ms:number):string{const s=Math.max(0,Math.floor(ms/1000));return`${Math.floor(s/60)}:${String(s%60).padStart(2,"0")}`;}
function formatError(error:unknown):string{const c=error instanceof Error?error.message:"music_failed";const m:Record<string,string>={music_disabled:"Модуль Music выключен.",music_unavailable:"Музыка недоступна: проверь yt-dlp и ffmpeg.",voice_channel_required:"Нужен голосовой канал.",music_voice_assigned_elsewhere:"Voice-канал закреплён за другим bot identity.",music_voice_not_assigned:"Voice-канал не назначен этой bot identity.",music_player_not_started:"Музыка не запущена.",music_player_in_other_voice:"Плеер уже работает в другом voice-канале.",music_query_required:"Укажи трек или URL.",music_track_not_found:"Трек не найден.",music_search_failed:"yt-dlp не смог выполнить поиск.",music_stream_resolve_failed:"Не удалось получить прямой аудиопоток.",music_provider_requires_url:"Для этого источника нужна прямая ссылка: yt-dlp не предоставляет текстовый поиск для этой площадки.",music_spotify_track_only:"Для Spotify сейчас поддерживаются ссылки на отдельные треки; воспроизведение идёт через эквивалентный доступный источник.",music_queue_too_short:"В очереди недостаточно треков.",invalid_repeat_mode:"Некорректный repeat mode.",invalid_seek:"Некорректный seek.",invalid_volume:"Некорректная громкость.",invalid_music_filter:"Некорректный фильтр.",invalid_queue_position:"Некорректная позиция очереди.",invalid_queue_move:"Некорректное перемещение трека."};return m[c.split(":")[0]??c]??c;}
async function runProcess(file:string,args:string[],timeoutMs:number):Promise<Result>{return await new Promise(resolve=>{const child=spawn(file,args,{windowsHide:true,stdio:["ignore","pipe","pipe"]});let stdout="",stderr="",done=false;const finish=(r:Result)=>{if(done)return;done=true;clearTimeout(timer);resolve(r);};const timer=setTimeout(()=>{try{child.kill("SIGKILL");}catch{}finish({code:-1,stdout,stderr:stderr+"\nprocess timeout"});},timeoutMs);timer.unref();child.stdout.on("data",c=>stdout+=String(c));child.stderr.on("data",c=>stderr+=String(c));child.once("error",e=>finish({code:-1,stdout,stderr:String(e)}));child.once("close",c=>finish({code:c??0,stdout,stderr}));});}
