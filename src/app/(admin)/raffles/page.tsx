import type { Metadata } from "next";
import Link from "next/link";

import { db } from "@/lib/db";
import { Alert, AlertDescription, AlertTitle } from "@/components/ui/alert";
import { Button } from "@/components/ui/button";
import {
  Card,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";

import { NewRaffleDialog } from "./new-raffle-dialog";
import { RaffleStatusBadge } from "./status-badge";

export const metadata: Metadata = {
  title: "Raffles — Raffle App",
};

export const dynamic = "force-dynamic";

// Dashboard (E1-01 Feature B): all raffles, newest first (D-E25). No
// duplicate/archive quick actions in v1 (D-E25).
export default async function RafflesPage() {
  let raffles;
  try {
    raffles = await db.raffle.findMany({
      orderBy: { createdAt: "desc" },
    });
  } catch (err) {
    console.error("Failed to load raffles:", err);
    return (
      <div className="space-y-4">
        <h1 className="text-xl font-semibold tracking-tight">Raffles</h1>
        <Alert variant="destructive">
          <AlertTitle>Could not load raffles. Please retry.</AlertTitle>
          <AlertDescription>
            <Button asChild variant="outline" size="sm" className="mt-2">
              <Link href="/raffles">Retry</Link>
            </Button>
          </AlertDescription>
        </Alert>
      </div>
    );
  }

  return (
    <div className="space-y-4">
      <div className="flex items-center justify-between gap-4">
        <h1 className="text-xl font-semibold tracking-tight">Raffles</h1>
        <NewRaffleDialog />
      </div>

      {raffles.length === 0 ? (
        <Card className="border-dashed">
          <CardHeader className="items-center py-10 text-center">
            <CardTitle className="text-base">No raffles yet</CardTitle>
            <CardDescription>
              Create your first raffle to start configuring an event.
            </CardDescription>
            <div className="pt-2">
              <NewRaffleDialog triggerLabel="Create your first raffle" />
            </div>
          </CardHeader>
        </Card>
      ) : (
        <div className="grid gap-3 sm:grid-cols-2">
          {raffles.map((raffle) => (
            <Link
              key={raffle.id}
              href={`/raffles/${raffle.id}`}
              className="group rounded-xl focus-visible:outline-2 focus-visible:outline-ring"
            >
              <Card className="h-full gap-2 py-4 transition-colors group-hover:border-foreground/20">
                <CardHeader className="gap-1 px-4">
                  <div className="flex items-start justify-between gap-3">
                    <CardTitle className="truncate text-base">
                      {raffle.title}
                    </CardTitle>
                    <RaffleStatusBadge status={raffle.status} />
                  </div>
                  {raffle.description ? (
                    <CardDescription className="line-clamp-2">
                      {raffle.description}
                    </CardDescription>
                  ) : null}
                </CardHeader>
              </Card>
            </Link>
          ))}
        </div>
      )}
    </div>
  );
}
