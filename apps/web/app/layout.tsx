import "@suiem/ui/styles.css";
import "./app.css";
import type { Metadata, Viewport } from "next";
import type { ReactNode } from "react";
import { Providers } from "./providers";

export const metadata: Metadata = {
  title: "Suiem: research before you invest",
  description:
    "AI-assisted research, theses and community recognition. Not affiliated with Robinhood Markets, Inc.",
};
export const viewport: Viewport = { width: "device-width", initialScale: 1, themeColor: "#0b1426" };

export default function RootLayout({ children }: { children: ReactNode }) {
  return (
    <html lang="en" data-theme="dark">
      <body>
        <a className="s-skip" href="#main">
          Skip to content
        </a>
        <Providers>{children}</Providers>
      </body>
    </html>
  );
}
