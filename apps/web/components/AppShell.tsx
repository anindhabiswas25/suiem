"use client";
import { NAV_ITEMS } from "@suiem/shared/policy";
import { DISCLAIMER, ErrorState, LoadingState, NetworkBadge, Wordmark } from "@suiem/ui";
import { useQueryClient } from "@tanstack/react-query";
import Link from "next/link";
import { usePathname, useRouter } from "next/navigation";
import { useEffect, useState, type ReactNode } from "react";
import { api } from "../lib/api";
import { useMe } from "../lib/session";
import { NetworkSwitcher } from "./NetworkSwitcher";

export function Footer() {
  return (
    <footer className="footer">
      {DISCLAIMER} Testnet assets have no value and are not securities. $WIF carries no promise of
      value or return. Nothing here is investment advice.{" "}
      <Link href="/help">Help &amp; disclosures</Link>
    </footer>
  );
}

function ThemeToggle() {
  const [theme, setTheme] = useState<"dark" | "light">("dark");
  useEffect(() => {
    try {
      const saved = localStorage.getItem("suiem.theme");
      if (saved === "light" || saved === "dark") setTheme(saved);
    } catch {
      /* storage unavailable: keep default */
    }
  }, []);
  useEffect(() => {
    document.documentElement.dataset.theme = theme;
    try {
      localStorage.setItem("suiem.theme", theme);
    } catch {
      /* ignore */
    }
  }, [theme]);
  return (
    <button
      className="s-btn"
      data-variant="ghost"
      onClick={() => setTheme(theme === "dark" ? "light" : "dark")}
      aria-label={`Switch to ${theme === "dark" ? "light" : "dark"} mode`}
    >
      {theme === "dark" ? "☀ Light" : "☾ Dark"}
    </button>
  );
}

/** Signed-in shell: every PRD §4.1 route in the nav. Redirects to login/onboarding as needed. */
export function AppShell({ children }: { children: ReactNode }) {
  const me = useMe();
  const router = useRouter();
  const pathname = usePathname();
  const qc = useQueryClient();

  useEffect(() => {
    if (me.data === null) router.replace(`/login?next=${encodeURIComponent(pathname)}`);
    else if (me.data && !me.data.onboardingCompletedAt) router.replace("/onboarding");
  }, [me.data, pathname, router]);

  if (me.isPending || me.data === null || (me.data && !me.data.onboardingCompletedAt)) {
    return (
      <main id="main" className="public">
        <LoadingState label="Checking your session…" />
      </main>
    );
  }
  if (me.isError) {
    return (
      <main id="main" className="public">
        <ErrorState
          message="We couldn't reach Suiem. Is the API running?"
          retry={() => void me.refetch()}
        />
      </main>
    );
  }

  async function logout() {
    await api("POST", "/auth/logout", {}).catch(() => undefined);
    qc.setQueryData(["me"], null);
    router.replace("/login");
  }

  return (
    <div className="shell">
      <nav className="shell-nav" aria-label="Main">
        <Wordmark href="/home" />
        <ul>
          {NAV_ITEMS.map((item) => (
            <li key={item.key}>
              <Link
                className="nav-link"
                href={item.href}
                aria-current={pathname.startsWith(item.href) ? "page" : undefined}
              >
                <span>{item.label}</span>
                {item.network ? (
                  <span
                    aria-label={item.network === "mainnet" ? "Mainnet" : "Testnet"}
                    className="s-small s-muted"
                  >
                    {item.network === "mainnet" ? "◆" : "◇"}
                  </span>
                ) : null}
              </Link>
            </li>
          ))}
        </ul>
      </nav>
      <div className="shell-main">
        <header className="shell-top">
          <NetworkSwitcher />
          <span className="s-small s-muted">
            Signed in as <strong>{me.data.displayName ?? me.data.handle}</strong>
          </span>
          <ThemeToggle />
          <button className="s-btn" data-variant="ghost" onClick={() => void logout()}>
            Sign out
          </button>
        </header>
        <main id="main" className="shell-content">
          {children}
        </main>
        <Footer />
      </div>
    </div>
  );
}

/** Page header with an optional network badge. */
export function PageHeader({
  title,
  network,
  children,
}: {
  title: string;
  network?: "mainnet" | "testnet" | "offchain";
  children?: ReactNode;
}) {
  return (
    <div className="s-stack" style={{ gap: 6 }}>
      <div className="s-row">
        <h1>{title}</h1>
        {network ? <NetworkBadge network={network} /> : null}
      </div>
      {children ? (
        <p className="s-muted" style={{ margin: 0 }}>
          {children}
        </p>
      ) : null}
    </div>
  );
}
