export type MusicSource =
  | "youtube"
  | "soundcloud"
  | "spotify"
  | "apple-music"
  | "deezer"
  | "yandex-music"
  | "vk-music"
  | "sber-sound"
  | "unknown";

export type Track = {
  id: string;
  title: string;
  author: string;
  durationMs: number | null;
  source: MusicSource;
  uri: string;
  artworkUrl?: string;
};

export type PlaybackState = {
  guildId: string;
  botIdentityId: string;
  voiceChannelId: string;
  current: Track | null;
  queue: Track[];
  positionMs: number;
  paused: boolean;
  volume: number;
  repeat: "off" | "track" | "queue";
  shuffle: boolean;
};

export interface MusicProvider {
  readonly source: MusicSource;
  canResolve(input: string): boolean;
  search(query: string, limit: number): Promise<Track[]>;
  resolve(input: string): Promise<Track | Track[]>;
}
