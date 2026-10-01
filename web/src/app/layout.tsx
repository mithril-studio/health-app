import type { Metadata } from "next";
import { cookies } from "next/headers";
import { GeistSans } from "geist/font/sans";
import { Workspace } from "@/components/workspace";
import { copy } from "@/lib/i18n";
import "./globals.css";
export const metadata: Metadata = { title: { default: copy.brand, template: `%s · ${copy.brand}` }, description: copy.login.description, robots: { index: false, follow: false } };
export default async function RootLayout({ children }: { children: React.ReactNode }) {
  const jar = await cookies(); const theme = jar.get("theme")?.value === "dark" ? "dark" : "light";
  return <html lang="en" className={`${GeistSans.variable} ${theme === "dark" ? "dark" : ""}`}><body><Workspace theme={theme} sidebarOpen={jar.get("sidebar_state")?.value !== "0"}>{children}</Workspace></body></html>;
}
