"use client";
import { NAV_ITEMS, type NavItem } from "@suiem/shared/policy";
import { Avatar, DISCLAIMER, ErrorState, LoadingState, NetworkBadge, Wordmark } from "@suiem/ui";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import Link from "next/link";
import { usePathname, useRouter } from "next/navigation";
import { useEffect, useRef, useState, type ReactNode } from "react";
import { api, ApiRequestError } from "../lib/api";
import { useMe } from "../lib/session";
import { NetworkSwitcher } from "./NetworkSwitcher";

export function Footer() {
  return (
    <footer className="footer">
      <div className="footer-inner">
        <span className="footer-brand">Suiem</span>
        <p>
          {DISCLAIMER} Testnet assets have no value and are not securities. $WIF carries no promise
          of value or return. Nothing here is investment advice.{" "}
          <Link href="/help">Help &amp; disclosures</Link>
        </p>
      </div>
    </footer>
  );
}

export function useTheme() {
  const [theme, setTheme] = useState<"dark" | "light">("light");
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
  return [theme, setTheme] as const;
}

const isCurrent = (item: NavItem, pathname: string) =>
  (item.match ?? [item.href]).some(
    (p) => pathname === p || pathname.startsWith(p.endsWith("/") ? p : `${p}/`),
  );

function NotificationBell() {
  const n = useQuery<{ unread: number }>({
    queryKey: ["notifications", "count"],
    queryFn: () => api("GET", "/notifications"),
    refetchInterval: 60_000,
    staleTime: 30_000,
  });
  const unread = n.data?.unread ?? 0;
  return (
    <Link
      href="/notifications"
      className="icon-btn"
      aria-label={unread ? `Notifications, ${unread} unread` : "Notifications"}
    >
      <svg viewBox="0 0 24 24" width="20" height="20" aria-hidden="true">
        <path
          d="M6 16V11a6 6 0 1 1 12 0v5l1.5 2h-15L6 16Zm4 4h4"
          fill="none"
          stroke="currentColor"
          strokeWidth="1.7"
          strokeLinecap="round"
          strokeLinejoin="round"
        />
      </svg>
      {unread ? <span className="dot-count">{unread > 9 ? "9+" : unread}</span> : null}
    </Link>
  );
}

function UserMenu({
  name,
  handle,
  onLogout,
}: {
  name: string;
  handle: string;
  onLogout: () => void;
}) {
  const [open, setOpen] = useState(false);
  const [theme, setTheme] = useTheme();
  const ref = useRef<HTMLDivElement>(null);
  const pathname = usePathname();
  useEffect(() => setOpen(false), [pathname]);
  useEffect(() => {
    if (!open) return;
    const close = (e: MouseEvent | KeyboardEvent) => {
      if (
        e instanceof KeyboardEvent ? e.key === "Escape" : !ref.current?.contains(e.target as Node)
      )
        setOpen(false);
    };
    document.addEventListener("mousedown", close);
    document.addEventListener("keydown", close);
    return () => {
      document.removeEventListener("mousedown", close);
      document.removeEventListener("keydown", close);
    };
  }, [open]);
  return (
    <div className="menu" ref={ref}>
      <button
        className="menu-trigger"
        aria-haspopup="menu"
        aria-expanded={open}
        onClick={() => setOpen(!open)}
        aria-label="Account menu"
      >
        <Avatar name={name} />
      </button>
      {open ? (
        <div className="menu-pop" role="menu">
          <div className="menu-head">
            <Avatar name={name} />
            <div style={{ minWidth: 0 }}>
              <div className="s-serif menu-name">{name}</div>
              <div className="s-small s-muted">@{handle}</div>
            </div>
          </div>
          <Link role="menuitem" href={`/u/${handle}`}>
            Your profile
          </Link>
          <Link role="menuitem" href="/portfolio" className="mobile-only">
            Practice <NetworkBadge network="testnet" />
          </Link>
          <Link role="menuitem" href="/watchlist?tab=saved">
            Saved posts
          </Link>
          <Link role="menuitem" href="/settings">
            Settings
          </Link>
          <Link role="menuitem" href="/settings#extension">
            Browser extension
          </Link>
          <Link role="menuitem" href="/help">
            Help &amp; disclosures
          </Link>
          <div className="menu-sep" />
          <div className="menu-net">
            <span className="s-eyebrow">Wallet network</span>
            <NetworkSwitcher />
          </div>
          <div className="menu-sep" />
          <button role="menuitem" onClick={() => setTheme(theme === "dark" ? "light" : "dark")}>
            {theme === "dark" ? "Light mode" : "Dark mode"}
          </button>
          <button role="menuitem" onClick={onLogout}>
            Sign out
          </button>
        </div>
      ) : null}
    </div>
  );
}

const MOBILE_TABS = ["home", "research", "watchlist", "community", "elections"];

/** Signed-in shell: the landing's floating navbar on top, a five-tab bar on phones. */
export function AppShell({ children }: { children: ReactNode }) {
  const me = useMe();
  const router = useRouter();
  const pathname = usePathname();
  const qc = useQueryClient();
  useTheme();

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
    try {
      await api("POST", "/auth/logout", {});
    } catch (e) {
      // 401 means the session is already gone. Anything else: the session is still live, so say so
      // instead of pretending the user is signed out.
      if (!(e instanceof ApiRequestError && e.status === 401)) {
        window.alert(
          e instanceof ApiRequestError && e.status === 429
            ? "Couldn't sign out: too many requests. Please try again in a minute."
            : "Couldn't sign out. Please try again.",
        );
        return;
      }
    }
    qc.setQueryData(["me"], null);
    router.replace("/login");
  }

  const primary = NAV_ITEMS.filter((i) => i.group === "primary");
  const name = me.data.displayName ?? me.data.handle;

  return (
    <div className="shell">
      <header className="topbar">
        <nav className="topbar-inner" aria-label="Main">
          <Wordmark href="/home" compact />
          <ul className="topbar-links">
            {primary.map((item) => (
              <li key={item.key}>
                <Link
                  href={item.href}
                  aria-current={isCurrent(item, pathname) ? "page" : undefined}
                >
                  {item.label}
                  {item.network ? (
                    <span
                      className="net-dot"
                      data-network={item.network}
                      aria-label={item.network === "mainnet" ? "Mainnet" : "Testnet"}
                    />
                  ) : null}
                </Link>
              </li>
            ))}
          </ul>
          <div className="topbar-end">
            <Link href="/research" className="icon-btn" aria-label="Search companies">
              <svg viewBox="0 0 24 24" width="20" height="20" aria-hidden="true">
                <circle
                  cx="11"
                  cy="11"
                  r="6.5"
                  fill="none"
                  stroke="currentColor"
                  strokeWidth="1.7"
                />
                <path
                  d="m16 16 4 4"
                  stroke="currentColor"
                  strokeWidth="1.7"
                  strokeLinecap="round"
                />
              </svg>
            </Link>
            <NotificationBell />
            <UserMenu name={name} handle={me.data.handle} onLogout={() => void logout()} />
          </div>
        </nav>
      </header>
      <main id="main" className="shell-content">
        {children}
      </main>
      <Footer />
      <nav className="tabbar" aria-label="Main (mobile)">
        {primary
          .filter((i) => MOBILE_TABS.includes(i.key))
          .map((item) => (
            <Link
              key={item.key}
              href={item.href}
              aria-current={isCurrent(item, pathname) ? "page" : undefined}
            >
              <span className="tab-ico" aria-hidden="true" />
              {item.label}
            </Link>
          ))}
      </nav>
    </div>
  );
}

/** Page header in the landing's display type, with an optional eyebrow, badge and actions. */
export function PageHeader({
  title,
  eyebrow,
  network,
  actions,
  children,
}: {
  title: string;
  eyebrow?: string;
  network?: "mainnet" | "testnet" | "offchain";
  actions?: ReactNode;
  children?: ReactNode;
}) {
  return (
    <div className="page-head">
      <div className="s-stack" style={{ gap: 10, minWidth: 0 }}>
        {eyebrow || network ? (
          <div className="s-row" style={{ gap: 10 }}>
            {eyebrow ? <span className="s-eyebrow">{eyebrow}</span> : null}
            {network ? <NetworkBadge network={network} /> : null}
          </div>
        ) : null}
        <h1>{title}</h1>
        {children ? <p className="page-lede">{children}</p> : null}
      </div>
      {actions ? <div className="s-row">{actions}</div> : null}
    </div>
  );
}

/** Pill tabs that are real links (deep-linkable with ?tab=). */
export function TabLinks({
  tabs,
  current,
  label,
}: {
  tabs: { key: string; label: string; href: string }[];
  current: string;
  label: string;
}) {
  return (
    <nav className="s-tabs" aria-label={label}>
      {tabs.map((t) => (
        <Link key={t.key} href={t.href} aria-current={t.key === current ? "page" : undefined}>
          {t.label}
        </Link>
      ))}
    </nav>
  );
}
