export {
  YtDlpMusicEngine as Music,
  BUILTIN_MUSIC_COMMANDS,
  MAX_MUSIC_ENQUEUE_TRACKS,
  normalizeMusicSearchProvider,
  buildMusicSearchTarget,
  normalizeMusicSourceUrl,
  detectMusicSearchProvider,
  normalizeYtDlpEntry,
  normalizeMusicFilterPreset,
  buildFfmpegFilter,
  buildFfmpegArgs,
  adjustMusicVolume,
  musicResumePosition,
  canControlMusic,
  normalizeMusicRepeatMode,
  nextMusicRepeatMode,
  shouldAutoplayAfterQueueEnd,
  normalizeMusicQueuePosition,
  normalizeMusicQueueMove,
  musicPlayerNodeId
} from "./music-yt-dlp.js";

export type {
  MusicRepeatMode,
  MusicSearchProvider,
  MusicFilterPreset,
  MusicTrack
} from "./music-yt-dlp.js";
