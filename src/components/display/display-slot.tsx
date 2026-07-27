"use client";

import * as React from "react";

// Per-slot rendering for the public display board (E2-01 Features 2 and 5).
// States: placeholder → scrambling → settled; plus the distinct pulsing
// "redrawing…" treatment confined to its own slot (BR1/BR2).
// No status, reason, or ticket data can be rendered here — the props carry
// prize label and full name only (Feature 1 BR1).
//
// Visual treatment follows the approved projector mock: a white, heavily
// rounded card floating over the full-bleed background image, winner name
// first, then a small "Prize" caption and the prize label.

export type SlotState =
  | { kind: "scrambling"; fullName: string }
  | { kind: "settled"; fullName: string }
  | { kind: "redrawing" };
// Absent state = "not yet drawn" placeholder.

// Reveal animation runs for a full 5 s by explicit product direction, which
// supersedes the ~500–800 ms band in FSD E2-01 Feature 2 BR4. A single
// constant guarantees a simultaneous batch animates and settles together in
// one window rather than staggering.
const SCRAMBLE_MS = 5000;
// Characters lock in left-to-right over the tail of the window so five
// seconds resolves into the name instead of flickering flat until it snaps.
const LOCK_IN_START_MS = 3800;
const SCRAMBLE_FRAME_MS = 50;
const SCRAMBLE_CHARS = "ABCDEFGHIJKLMNOPQRSTUVWXYZ";

// Math.random is PERMITTED here: the scramble is purely cosmetic presentation
// and sits outside all draw paths — the fair random pick already happened
// server-side with crypto.getRandomValues (E1-04). See FSD E2-01 Feature 2 BR3.
function randomChar(): string {
  return SCRAMBLE_CHARS[Math.floor(Math.random() * SCRAMBLE_CHARS.length)];
}

/** How many leading characters have locked in at `elapsed` ms. */
function lockedCount(length: number, elapsed: number): number {
  if (elapsed <= LOCK_IN_START_MS) return 0;
  const progress =
    (elapsed - LOCK_IN_START_MS) / (SCRAMBLE_MS - LOCK_IN_START_MS);
  return Math.min(length, Math.ceil(progress * length));
}

/**
 * Renders the target with the first `locked` characters revealed and the rest
 * randomised. Whitespace is never scrambled, so the name keeps its word shape
 * and line wrapping stays stable for the whole 5 s.
 */
function scrambleFrom(target: string, locked: number): string {
  let out = target.slice(0, locked);
  for (let i = locked; i < target.length; i++) {
    out += /\s/.test(target[i]) ? target[i] : randomChar();
  }
  return out;
}

function ScrambledName({
  target,
  onSettle,
}: {
  target: string;
  onSettle: () => void;
}) {
  const [text, setText] = React.useState(() => scrambleFrom(target, 0));
  // Keep the latest settle callback without restarting the animation when the
  // parent re-renders mid-scramble.
  const onSettleRef = React.useRef(onSettle);
  React.useEffect(() => {
    onSettleRef.current = onSettle;
  });

  React.useEffect(() => {
    let elapsed = 0;
    const interval = setInterval(() => {
      elapsed += SCRAMBLE_FRAME_MS;
      setText(scrambleFrom(target, lockedCount(target.length, elapsed)));
    }, SCRAMBLE_FRAME_MS);
    const timer = setTimeout(() => {
      clearInterval(interval);
      onSettleRef.current();
    }, SCRAMBLE_MS);
    return () => {
      clearInterval(interval);
      clearTimeout(timer);
    };
  }, [target]);

  return <span className="whitespace-pre-wrap">{text}</span>;
}

export function DisplaySlot({
  prizeLabel,
  state,
  onSettle,
  className = "",
  style,
}: {
  prizeLabel: string;
  state: SlotState | undefined;
  onSettle: () => void;
  /** Layout-only classes from the board. */
  className?: string;
  /** Layout-only grid placement from the board. */
  style?: React.CSSProperties;
}) {
  const drawn = state !== undefined && state.kind !== "redrawing";

  return (
    <div
      data-slot="display-slot"
      style={style}
      className={
        // @container + cqi-based type: the card scales to ITS OWN width, not
        // the viewport's, so a 3-across or 4-across block stays readable
        // without breakpoint guesswork. Height follows from the type and the
        // percentage padding, which keeps the card's proportions constant as
        // the board's squeeze order narrows it.
        "@container font-sans flex min-w-0 flex-col items-center justify-center " +
        "rounded-[clamp(1rem,4cqi,3rem)] px-[7%] py-[6%] text-center " +
        "shadow-2xl shadow-black/30 transition-colors duration-300 " +
        (drawn ? "bg-white" : "bg-white/75 backdrop-blur-sm") +
        (className ? ` ${className}` : "")
      }
    >
      <p className="text-[clamp(1.5rem,12cqi,7rem)] leading-[1.05] font-bold tracking-tight text-balance break-words text-neutral-950">
        {state === undefined ? (
          <span className="text-[clamp(1rem,6cqi,2.5rem)] font-normal text-neutral-500">
            not yet drawn
          </span>
        ) : state.kind === "redrawing" ? (
          // Distinct pulsing treatment; no reason/status language (BR3).
          <span className="animate-pulse text-[clamp(1rem,6cqi,2.5rem)] font-normal text-neutral-600">
            Redrawing…
          </span>
        ) : state.kind === "scrambling" ? (
          <ScrambledName target={state.fullName} onSettle={onSettle} />
        ) : (
          <span>{state.fullName}</span>
        )}
      </p>

      <p className="mt-[4%] text-[clamp(0.75rem,3.2cqi,1.5rem)] font-normal tracking-[0.12em] text-neutral-700 uppercase">
        Prize
      </p>
      <p className="text-[clamp(1rem,5.8cqi,3.5rem)] leading-snug font-bold text-balance break-words text-neutral-950">
        {prizeLabel}
      </p>
    </div>
  );
}
