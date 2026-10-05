import TikTokCallbackClient from "./tiktok-callback-client";

export default async function TikTokCallbackPage({
  searchParams
}: {
  searchParams: Promise<{ code?: string; state?: string; error?: string; error_description?: string }>
}) {
  const params = await searchParams;
  if (params.error) {
    return <TikTokCallbackClient code="" state="" />;
  }
  return <TikTokCallbackClient code={params.code ?? ""} state={params.state ?? ""} />;
}
