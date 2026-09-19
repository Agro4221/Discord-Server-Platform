import { redirect } from "next/navigation";
import { currentSession } from "../lib/auth";
import { DashboardClient } from "./dashboard-client";

export default async function Home() {
  if (!await currentSession()) {
    redirect("/login");
  }

  return <DashboardClient />;
}
