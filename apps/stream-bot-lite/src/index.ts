import express from "express";
import { attachAdmin } from "./admin.js";
import { config } from "./config.js";
import { DiscordBot } from "./discord.js";
import { Store } from "./db.js";

const store = new Store(config.dbPath);
const bot = new DiscordBot(store);
const app = express();

app.disable("x-powered-by");
app.use(express.urlencoded({ extended: false }));
app.use(express.json({ limit: "32kb" }));
attachAdmin(app, store, bot.client, bot.announcements);

const server = app.listen(
  config.adminPort,
  config.adminHost,
  () => {
    console.log(
      "[admin] http://" + config.adminHost + ":" + config.adminPort
    );
  }
);

let shuttingDown = false;

async function shutdown(signal: string): Promise<void> {
  if (shuttingDown) return;
  shuttingDown = true;

  console.log("[main] " + signal);

  server.close();
  await bot.stop().catch((error) => {
    console.error("[shutdown] bot", error);
  });
  store.close();
}

process.once("SIGINT", () => void shutdown("SIGINT"));
process.once("SIGTERM", () => void shutdown("SIGTERM"));

process.on("unhandledRejection", (reason) => {
  console.error("[process] unhandledRejection", reason);
});

process.on("uncaughtException", (error) => {
  console.error("[process] uncaughtException", error);
  process.exitCode = 1;
});

try {
  await bot.start();
} catch (error) {
  console.error("[startup]", error);
  await shutdown("startup failure");
  process.exitCode = 1;
}
