export type MusicModuleHealth = {
  node: "starting" | "ready" | "down";
  players: number;
  identity: string;
};
