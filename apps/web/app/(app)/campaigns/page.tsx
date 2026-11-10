import { Placeholder } from "../../../components/Placeholder";

export const metadata = { title: "Campaigns · Suiem" };

export default function Page() {
  return (
    <Placeholder
      title="Campaigns"
      intro="Sponsor-funded, prefunded research campaigns."
      emptyTitle="No campaigns yet"
      sprint={7}
      network="mainnet"
    />
  );
}
