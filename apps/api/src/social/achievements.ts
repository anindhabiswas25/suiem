/**
 * Profile achievements (e.g. election winner badges) are supplied from outside the social module
 * through this interface, so social/reputation code never imports elections or $WIF
 * (depcruise `reputation-no-economy`). Achievements are display-only and never score evidence.
 */
export const ACHIEVEMENTS = Symbol("ACHIEVEMENTS");

export interface Achievement {
  kind: string;
  title: string;
  awardedAt: string | null;
  note: string;
}

export interface AchievementsProvider {
  forUser(userId: string): Promise<Achievement[]>;
}

export const NO_ACHIEVEMENTS: AchievementsProvider = { forUser: async () => [] };
