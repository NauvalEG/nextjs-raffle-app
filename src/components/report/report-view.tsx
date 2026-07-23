import type { ReportData, ReportSlot } from "@/lib/report-data";
import { Alert, AlertDescription, AlertTitle } from "@/components/ui/alert";
import { ExportButtons } from "@/components/report/export-buttons";
import { SlotHistory } from "@/components/report/slot-history";
import {
  ReportEventStatusPill,
  ReportRaffleStatusPill,
} from "@/components/report/status-pills";

// Read-only results report (E3-01 Feature 1). Self-contained by design
// (PRD AC5): imports ONLY generic ui primitives and report components —
// nothing from src/app/(admin)/** and no admin nav/chrome — so exposing the
// route publicly later is an access-control change, not a UI refactor.
// Zero mutations, zero audit writes (B-3): the only interactive elements are
// the history expanders and the export buttons.

function SlotCard({ slot }: { slot: ReportSlot }) {
  return (
    <div className="rounded-md border p-3">
      <div className="flex flex-wrap items-center gap-x-3 gap-y-1">
        <span className="text-sm text-muted-foreground">
          {slot.prizeName}
          <span className="ml-1 text-xs">#{slot.sequenceInAllocation}</span>
        </span>
        {slot.winner ? (
          <>
            <span className="font-medium">{slot.winner.fullName}</span>
            <span className="text-sm text-muted-foreground">
              Ticket #{slot.winner.ticketNumber}
            </span>
            <ReportEventStatusPill status={slot.winner.status} />
          </>
        ) : (
          <span className="text-sm italic text-muted-foreground">Not drawn</span>
        )}
      </div>
      {/* History affordance ONLY when superseded predecessors exist (Alt 3). */}
      {slot.history.length > 0 && (
        <div className="mt-2">
          <SlotHistory history={slot.history} />
        </div>
      )}
    </div>
  );
}

export function ReportView({ data }: { data: ReportData }) {
  const completed = data.raffle.status === "COMPLETED";

  return (
    <div className="space-y-6">
      {/* Persistent not-final banner (B-6 / D-E27). */}
      {!completed && (
        <Alert>
          <AlertTitle>Not final</AlertTitle>
          <AlertDescription>
            This raffle is not completed — results shown are not final.
          </AlertDescription>
        </Alert>
      )}

      <div className="space-y-2">
        <div className="flex flex-wrap items-center gap-3">
          <h2 className="text-lg font-semibold tracking-tight">
            {data.raffle.title} — Results Report
          </h2>
          <ReportRaffleStatusPill status={data.raffle.status} />
        </div>
        <p className="text-xs text-muted-foreground">
          Generated at {data.generatedAt} (UTC)
        </p>
        <ExportButtons raffleId={data.raffle.id} completed={completed} />
      </div>

      {data.rounds.length === 0 ? (
        <div className="rounded-lg border border-dashed p-10 text-center text-sm text-muted-foreground">
          This raffle has no rounds configured yet.
        </div>
      ) : (
        data.rounds.map((round) => (
          <section key={round.id} className="space-y-2">
            <h3 className="text-sm font-semibold">
              Round {round.order}: {round.label}
            </h3>
            <div className="space-y-2">
              {round.slots.map((slot) => (
                <SlotCard key={slot.slotKey} slot={slot} />
              ))}
            </div>
          </section>
        ))
      )}
    </div>
  );
}
