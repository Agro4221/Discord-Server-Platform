import type { ReactNode } from "react";

export const metadata = {
  title: "Discord Server Platform",
  description: "Local control center"
};

export default function RootLayout({ children }: { children: ReactNode }) {
  return (
    <html lang="ru">
      <body style={{ margin: 0 }}>{children}</body>
    </html>
  );
}
