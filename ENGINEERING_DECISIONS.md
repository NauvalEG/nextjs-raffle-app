# Engineering Decisions — Raffle App v1

Resolutions of every `[DECISION NEEDED]` and build-blocking `[ASSUMPTION]` from the FSDs
(E1-01 … E3-02). Where an FSD recommended a default, that default was adopted. All
choices are logged here and summarized in `documentation/RaffleApp/decisions.md` (D-006).

| ID | Topic (FSD ref) | Decision |
|----|-----------------|----------|
| D-E01 | Disqualified-entrant pool semantics (E1-04 §8 OD1, E2-02 §8 OD1) | **Stricter reading**: any `DISQUALIFIED` DrawEvent permanently excludes the entrant from the eligible pool, for draws and redraws alike. Single shared `getEligiblePool` in `src/lib/pool.ts`. |
| D-E02 | Draw-time audit entries (E1-04 §8 OD2) | **Intake reading**: the round-execution transaction writes one AuditLog entry (`action: "draw"`) per DrawEvent, atomically with the draw. |
| D-E03 | Never-reuse mechanism (E1-02 A12) | `RetiredTicket` ledger table `(raffleId, ticketNumber)` — rows written on every entrant creation, never deleted; blocks reuse after entrant removal. |
| D-E04 | Duplicate tickets within one import batch (E1-02 A8) | **First occurrence wins**; subsequent duplicates rejected per-row with "Duplicate ticket number" and line numbers. |
| D-E05 | "Sequential per raffle" tickets (E1-02 A13) | **Informational reading (a)**: app enforces uniqueness + never-reuse only; gaps allowed; no auto-numbering. |
| D-E06 | Lock permitted from which statuses (E1-03 A7) | Lock permitted from `DRAFT` or `OPEN` (matches `LEGAL_TRANSITIONS` in `src/lib/lifecycle.ts`). Zero-round / zero-draw plans are refused at lock (E1-03 A6). |
| D-E07 | `locked → drawn` transition point (E1-04 A1) | Raffle transitions to `DRAWN` when the **final** round's transaction commits; stays `LOCKED` while earlier rounds are drawn. |
| D-E08 | Round draw order (E1-04 A2) | Strictly in configured order; skipping ahead rejected server-side. |
| D-E09 | Admin refresh mid-round (E1-04 A3) | Admin draw screen resumes with all committed picks of the current round visible; reveal clicks are presentation pacing on the trusted admin side. Secrecy boundary is the display page. |
| D-E10 | Transitions out of `claimed` (E2-02 OD2) | **Reading A — terminal.** A claimed prize cannot be un-claimed in-system. |
| D-E11 | Direct reversals out of `disqualified` / `released_to_pool` (E2-02 OD3) | **Reading A — terminal for direct status change.** The only path onward is redraw (eligible on exactly these two statuses). |
| D-E12 | Multi-win entrant in results export (E3-01 B-13 / DN-1) | **Interpretation A**: all outcomes chronologically joined with `"; "` in `draw_round`/`prize`; `winner_status` = status of the latest event. |
| D-E13 | Redraw failure after `redraw-start` (E2-01 A8) | Keep the documented three-message contract (no `redraw-cancel`); slot stays "redrawing…" until a retried redraw resolves. Operator retries promptly under live conditions. |
| D-E14 | Session model (E1-01 A-02/A-03/A-10) | Stateless signed JWT cookie (jose HS256), 24 h expiry, logout action included. |
| D-E15 | PIN format (E1-01 A-04) | Numeric, minimum 6 digits (enforced at hash provisioning; login form accepts any non-empty input and compares via bcrypt). |
| D-E16 | Prize type names (E1-01 A-09) | Unique per raffle, case-insensitive (checked in action; DB unique on exact name as backstop). No rename in v1. |
| D-E17 | Duplicate (round, prizeType) allocation rows (E1-03 A4) | **Allowed, not merged** — literal data-model reading. |
| D-E18 | Status changes / redraws gated on raffle status (E2-02 A4) | Permitted while `DRAWN`; frozen at `COMPLETED`. |
| D-E19 | Formula-injection hardening (E3-01 A-6/B-18) | **Applied**: exported cells beginning with `=`, `+`, `-`, `@` are prefixed with `'`. |
| D-E20 | Contact column in results export (E3-01 A-3/B-9) | Omitted when no entrant of the raffle has a contact value; otherwise present with empty cells. |
| D-E21 | Log-export timestamps (E3-01 A-7) | ISO 8601 UTC (`toISOString()`). |
| D-E22 | Export filenames (E3-01 A-4) | `raffle-<id>-results.csv` / `raffle-<id>-log.csv`. |
| D-E23 | Import limits (E1-02 A3) | 5 MB / 50,000 rows defensive cap on the in-request parse path. |
| D-E24 | Contact column aliases (E1-02 A6) | Auto-detect aliases: `contact`, `email`, `phone` (case-insensitive), plus ticket aliases `ticket`, `ticket_number`, `id` and name aliases `name`, `full_name`, `fullname`. |
| D-E25 | Dashboard sort / quick actions (E1-01 A-06, DN) | Newest-first. No duplicate/archive quick actions in v1 (PRD has no story for them). |
| D-E26 | Display page status gating (E2-01 A1) | No status gating; board renders whatever structure display-meta returns at load; structure is load-time-static. |
| D-E27 | Report/exports before completion (E3-01 A-2) | Permitted — not-final banner on report; confirmation dialog before pre-completion exports; routes never hard-block on status. |
| D-E28 | Export downloads not audit-logged (E3-01 A-5/B-17) | Confirmed: exports are read-only; no audit entry. |
