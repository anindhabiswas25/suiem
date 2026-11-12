import { redirect } from "next/navigation";

/** Campaigns are a tab of Elections. */
export default function Campaigns() {
  redirect("/elections?tab=campaigns");
}
