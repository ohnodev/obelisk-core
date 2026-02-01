import type { Metadata } from "next";
import "./globals.css";
import "./styles/fonts.css";

export const metadata: Metadata = {
  title: "Obelisk Core | Visual Workflow Editor",
  description: "Visual node-based workflow editor for Obelisk Core AI agents",
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
        <script src="/lib/litegraph/litegraph.js"></script>
      </head>
      <body>
        {children}
      </body>
    </html>
  );
}
