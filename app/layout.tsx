import type { Metadata } from "next";
import { Geist, Geist_Mono } from "next/font/google";
import { cookies } from "next/headers";
import type { CSSProperties } from "react";
import "./globals.css";

const geistSans = Geist({
  variable: "--font-geist-sans",
  subsets: ["latin"],
});

const geistMono = Geist_Mono({
  variable: "--font-geist-mono",
  subsets: ["latin"],
});

export const metadata: Metadata = {
  title: "AI Assistant Dashboard",
  description: "Modern fintech approval dashboard built with Next.js.",
};

function getThemeStyle(theme: "dark" | "light"): CSSProperties {
  if (theme === "light") {
    return {
      colorScheme: "light",
      backgroundColor: "#edf1f4",
      color: "#17202a",
      ["--background" as string]: "#edf1f4",
      ["--foreground" as string]: "#17202a",
      ["--app-bg" as string]: "#edf1f4",
      ["--panel-bg" as string]: "#f8fafb",
      ["--surface-bg" as string]: "#f3f6f8",
      ["--surface-bg-elevated" as string]: "#ffffff",
      ["--surface-hover" as string]: "#eef3f6",
      ["--panel-border" as string]: "#d3dbe3",
      ["--panel-border-strong" as string]: "#bbc7d2",
      ["--text-primary" as string]: "#17202a",
      ["--text-secondary" as string]: "#334155",
      ["--text-muted" as string]: "#708090",
      ["--line-muted" as string]: "#a3b0bc",
      ["--accent-positive" as string]: "#148a63",
      ["--accent-positive-soft" as string]: "rgba(20, 138, 99, 0.22)",
    };
  }

  return {
    colorScheme: "dark",
    backgroundColor: "#14181d",
    color: "#e6e8eb",
    ["--background" as string]: "#14181d",
    ["--foreground" as string]: "#e6e8eb",
    ["--app-bg" as string]: "#14181d",
    ["--panel-bg" as string]: "#1a1f26",
    ["--surface-bg" as string]: "#171b22",
    ["--surface-bg-elevated" as string]: "#1d232b",
    ["--surface-hover" as string]: "#232a33",
    ["--panel-border" as string]: "#2a313b",
    ["--panel-border-strong" as string]: "#3a4450",
    ["--text-primary" as string]: "#e6e8eb",
    ["--text-secondary" as string]: "#d5dae0",
    ["--text-muted" as string]: "#8792a0",
    ["--line-muted" as string]: "#4b5662",
    ["--accent-positive" as string]: "#45c69a",
    ["--accent-positive-soft" as string]: "rgba(69, 198, 154, 0.32)",
  };
}

export default async function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
  const cookieStore = await cookies();
  const savedTheme = cookieStore.get("dashboard-theme")?.value;
  const initialTheme = savedTheme === "light" ? "light" : "dark";
  const themeStyle = getThemeStyle(initialTheme);

  return (
    <html
      lang="en"
      data-theme={initialTheme}
      data-theme-ready="false"
      suppressHydrationWarning
      className={`${geistSans.variable} ${geistMono.variable} h-full antialiased`}
      style={themeStyle}
    >
      <body className="min-h-full font-sans" style={themeStyle}>
        {children}
      </body>
    </html>
  );
}
