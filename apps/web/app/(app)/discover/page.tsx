import { redirect } from "next/navigation";

/** Discover is the Explore tab of Research. */
export default function Discover() {
  redirect("/research?tab=explore");
}
