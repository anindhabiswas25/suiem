import { Placeholder } from "../../../components/Placeholder";

export const metadata = { title: "Notifications · Suiem" };

export default function Page() {
  return (
    <Placeholder
      title="Notifications"
      intro="Updates on your research, theses and elections. No alert spam."
      emptyTitle="You're all caught up"
      sprint={3}
    />
  );
}
