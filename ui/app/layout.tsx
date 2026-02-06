import type { Metadata } from "next";
import "./globals.css";
import "./styles/fonts.css";

export const metadata: Metadata = {
  title: "Obelisk Core | Visual Workflow Editor",
  description: "Visual node-based workflow editor for Obelisk Core AI agents",
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
      </head>
      <body>
        {children}
      </body>
    </html>
  );
}
