import { Placeholder } from "../../../components/Placeholder";

export const metadata = { title: "Research · Suiem" };

export default function Page() {
  return (
    <Placeholder
      title="Research"
      intro="Sourced, cited AI research briefs on companies you choose."
      emptyTitle="No research briefs yet"
      sprint={4}
    />
  );
}
