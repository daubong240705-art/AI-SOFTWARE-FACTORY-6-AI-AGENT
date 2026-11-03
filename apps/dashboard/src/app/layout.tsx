import type { Metadata } from "next";
import "./globals.css";
import { AuthProvider } from "@/components/workspace";

export const metadata: Metadata = {
  title: "AI Software Factory · Workspace",
  description: "Không gian điều phối phát triển phần mềm với sáu AI Agent.",
};

export default function RootLayout({
  children,
}: Readonly<{ children: React.ReactNode }>) {
  return (
    <html lang="vi">
      <body>
        <AuthProvider>{children}</AuthProvider>
      </body>
    </html>
  );
}
