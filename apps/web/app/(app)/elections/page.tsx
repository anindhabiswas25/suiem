import { Placeholder } from "../../../components/Placeholder";

export const metadata = { title: "Elections · Suiem" };

export default function Page() {
  return (
    <Placeholder
      title="Elections"
      intro="Weekly community elections. Votes burn real $WIF and are irreversible. $WIF carries no promise of value or return."
      emptyTitle="No elections yet"
      sprint={7}
      network="mainnet"
    />
  );
}
