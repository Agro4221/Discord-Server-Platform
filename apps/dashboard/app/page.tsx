import { redirect } from "next/navigation";
import { currentSession } from "../lib/auth";
import { DiscordAdmin } from "./discord-admin";

export default async function Home() {
  if (!await currentSession()) {
    redirect("/login");
  }

  return <DiscordAdmin />;
}
