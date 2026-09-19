import type { ModuleContext, PlatformModule } from "./module.js";
import { logger } from "./logger.js";

export class ModuleRegistry {
  private readonly modules = new Map<string, PlatformModule>();
  private readonly controller = new AbortController();

  register(module: PlatformModule): void {
    if (this.modules.has(module.name)) {
      throw new Error(`Module already registered: ${module.name}`);
    }
    this.modules.set(module.name, module);
  }

  list(): string[] {
    return [...this.modules.keys()];
  }

  async initAll(): Promise<void> {
    for (const module of this.modules.values()) {
      try {
        await module.init({ signal: this.controller.signal });
        logger.info("Module ready", { module: module.name });
      } catch (error) {
        logger.error("Module initialization failed", { module: module.name, error: String(error) });
        throw error;
      }
    }
  }

  async shutdownAll(): Promise<void> {
    this.controller.abort();
    const modules = [...this.modules.values()].reverse();
    for (const module of modules) {
      try {
        await module.shutdown();
      } catch (error) {
        logger.error("Module shutdown failed", { module: module.name, error: String(error) });
      }
    }
  }
}
