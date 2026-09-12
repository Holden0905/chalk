import Stub from "@/components/Stub";
import { toOddsName } from "@/lib/teams";

export default async function TeamPage({ params }: { params: Promise<{ abbr: string }> }) {
  const { abbr } = await params;
  const name = toOddsName(abbr) ?? abbr.toUpperCase();
  return (
    <Stub title={name} phase="Phase 2">
      Rating history, weekly splits, schedule and results for {name}. Not built
      yet.
    </Stub>
  );
}
