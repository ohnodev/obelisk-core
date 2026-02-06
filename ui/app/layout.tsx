import type { Metadata } from "next";
import "./globals.css";
import "./styles/fonts.css";

const siteUrl = "https://build.theobelisk.ai";
const ogImageUrl = `${siteUrl}/build-og-image.jpg`;

export const metadata: Metadata = {
  title: "Obelisk Build | Visual Builder for Autonomous AI Agents",
  description: "Visual node-based builder for creating and deploying autonomous AI agents. Design complex workflows with drag-and-drop simplicity.",
  keywords: ["AI agents", "autonomous agents", "workflow builder", "visual programming", "LLM", "AI automation", "no-code AI"],
  authors: [{ name: "The Obelisk", url: "https://theobelisk.ai" }],
  creator: "The Obelisk",
  publisher: "The Obelisk",
  metadataBase: new URL(siteUrl),
  alternates: {
    canonical: siteUrl,
  },
  icons: {
    icon: [
      { url: "/favicon.ico" },
      { url: "/favicon-16x16.png", sizes: "16x16", type: "image/png" },
      { url: "/favicon-32x32.png", sizes: "32x32", type: "image/png" },
    ],
    apple: [
      { url: "/apple-touch-icon.png", sizes: "180x180" },
    ],
  },
  manifest: "/site.webmanifest",
  openGraph: {
    type: "website",
    url: siteUrl,
    title: "Obelisk Build | Visual Builder for Autonomous AI Agents",
    description: "Visual node-based builder for creating and deploying autonomous AI agents. Design complex workflows with drag-and-drop simplicity.",
    siteName: "The Obelisk",
    images: [
      {
        url: ogImageUrl,
        width: 1200,
        height: 630,
        alt: "Obelisk Build - Visual Builder for Autonomous AI Agents",
      },
    ],
  },
  twitter: {
    card: "summary_large_image",
    site: "@theobeliskai",
    creator: "@theobeliskai",
    title: "Obelisk Build | Visual Builder for Autonomous AI Agents",
    description: "Visual node-based builder for creating and deploying autonomous AI agents. Design complex workflows with drag-and-drop simplicity.",
    images: [ogImageUrl],
  },
  robots: {
    index: true,
    follow: true,
  },
  other: {
    "telegram:channel": "https://t.me/theobeliskportal",
  },
};

export default function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
  return (
    <html lang="en" suppressHydrationWarning>
      <head>
        <meta name="viewport" content="width=device-width, initial-scale=1.0" />
        <meta name="theme-color" content="#000000" />
        <script src="/lib/litegraph/litegraph.js"></script>
        <script src="/lib/litegraph-widgets/textarea-widget.js"></script>
        <script src="/lib/litegraph-widgets/touch-handler.js"></script>
      </head>
      <body>
        {children}
      </body>
    </html>
  );
}
