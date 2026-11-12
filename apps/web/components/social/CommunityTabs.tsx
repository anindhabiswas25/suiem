"use client";
import { TabLinks } from "../AppShell";

/** Feed, Communities and Leaderboard are one destination: Community. */
export function CommunityTabs({ current }: { current: "feed" | "communities" | "leaderboard" }) {
  return (
    <TabLinks
      label="Community"
      current={current}
      tabs={[
        { key: "feed", label: "Feed", href: "/feed" },
        { key: "communities", label: "Communities", href: "/communities" },
        { key: "leaderboard", label: "Leaderboard", href: "/leaderboard" },
      ]}
    />
  );
}
