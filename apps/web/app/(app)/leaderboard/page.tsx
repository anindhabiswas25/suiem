import { Placeholder } from "../../../components/Placeholder";

export const metadata = { title: "Leaderboard · Suiem" };

export default function Page() {
  return (
    <Placeholder
      title="Leaderboard"
      intro="Ranked by the 50/50 Suiem Score: investor process and community contribution. Opt-in only."
      emptyTitle="No ranked profiles yet"
      sprint={6}
    />
  );
}
