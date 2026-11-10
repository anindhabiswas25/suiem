import { Placeholder } from "../../../components/Placeholder";

export const metadata = { title: "Feed · Suiem" };

export default function Page() {
  return (
    <Placeholder
      title="Feed"
      intro="Research and theses from people you follow."
      emptyTitle="Your feed is empty"
      sprint={6}
    />
  );
}
