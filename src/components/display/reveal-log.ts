import {
  currentRoundKey,
  revealLogKey,
  type RevealLogEntry,
} from "@/lib/broadcast";

// sessionStorage reveal log (E2-01 Feature 4 / A9). Key raffle-display-log-
// <raffleId>, value a JSON array of {slotId, fullName} in receipt order,
// latest-name-wins per slot on redraw. Per-tab lifetime by decision D-003 —
// never substitute localStorage. All failures are silent: reveals still
// render live when storage is unavailable (A5).

function isValidEntry(value: unknown): value is RevealLogEntry {
  return (
    typeof value === "object" &&
    value !== null &&
    typeof (value as { slotId?: unknown }).slotId === "string" &&
    (value as { slotId: string }).slotId.length > 0 &&
    typeof (value as { fullName?: unknown }).fullName === "string" &&
    (value as { fullName: string }).fullName.length > 0
  );
}

function writeLog(raffleId: string, entries: RevealLogEntry[]): void {
  try {
    sessionStorage.setItem(revealLogKey(raffleId), JSON.stringify(entries));
  } catch {
    // Quota/disabled: render live anyway; replay is degraded, silently (A5).
  }
}

/**
 * Reads the reveal log. Individual invalid entries are skipped; a
 * structurally invalid/corrupt log is reset to empty — fresh start, no
 * visible error (Feature 4 Alt 3).
 */
export function readRevealLog(raffleId: string): RevealLogEntry[] {
  let raw: string | null;
  try {
    raw = sessionStorage.getItem(revealLogKey(raffleId));
  } catch {
    return [];
  }
  if (raw === null) return [];
  try {
    const parsed: unknown = JSON.parse(raw);
    if (!Array.isArray(parsed)) throw new Error("not an array");
    return parsed.filter(isValidEntry);
  } catch {
    writeLog(raffleId, []); // corrupt log → reset, fresh start
    return [];
  }
}

/** Appends a reveal entry in receipt order (Feature 4 Step 1). */
export function appendRevealLog(raffleId: string, entry: RevealLogEntry): void {
  writeLog(raffleId, [...readRevealLog(raffleId), entry]);
}

/**
 * Supersedes the entry for a slotId with the redraw's replacement name so
 * replay yields the latest name per slot (Feature 4 BR4). Appends when no
 * prior entry exists (self-sufficient redraw-result, Feature 5 Alt 1).
 */
export function supersedeRevealLog(
  raffleId: string,
  entry: RevealLogEntry
): void {
  const entries = readRevealLog(raffleId);
  const index = entries.findIndex((e) => e.slotId === entry.slotId);
  if (index >= 0) entries[index] = entry;
  else entries.push(entry);
  writeLog(raffleId, entries);
}

/**
 * Reads the round the display was last showing, or null when nothing is
 * stored. The caller must still verify the id exists in display-meta — a
 * stored round can outlive a structural change.
 */
export function readCurrentRound(raffleId: string): string | null {
  try {
    return sessionStorage.getItem(currentRoundKey(raffleId));
  } catch {
    return null;
  }
}

/** Persists the round now on display. Silent on failure, as with the log (A5). */
export function writeCurrentRound(raffleId: string, roundId: string): void {
  try {
    sessionStorage.setItem(currentRoundKey(raffleId), roundId);
  } catch {
    // Quota/disabled: the live board is still correct; only refresh degrades.
  }
}
