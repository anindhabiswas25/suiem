import { Placeholder } from "../../../components/Placeholder";

export const metadata = { title: "Watchlist · Suiem" };

export default function Page() {
  return (
    <Placeholder
      title="Watchlist"
      intro="Companies you're following, with your notes and thesis links."
      emptyTitle="Your watchlist is empty"
      sprint={4}
    />
  );
}
