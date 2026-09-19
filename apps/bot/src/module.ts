export type ModuleContext = {
  signal: AbortSignal;
};

export interface PlatformModule {
  readonly name: string;
  init(context: ModuleContext): Promise<void>;
  shutdown(): Promise<void>;
}
