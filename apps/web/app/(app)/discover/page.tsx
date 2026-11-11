"use client";
import { Card } from "@suiem/ui";
import Link from "next/link";
import { PageHeader } from "../../../components/AppShell";
import { EntitySearch } from "../../../components/research/ui";

export default function Discover() {
  return (
    <>
      <PageHeader title="Discover">
        Find companies to research. Community theses arrive with the social sprint.
      </PageHeader>
      <Card title="Search the registry">
        <EntitySearch />
        <span className="s-small s-muted">
          Results open the research page for that company.{" "}
          <Link href="/research/compare">Compare companies</Link>
        </span>
      </Card>
    </>
  );
}
