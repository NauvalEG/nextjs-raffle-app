// Uniform Server Action result shape. Actions never throw user-facing errors;
// they return { ok: false, error } so forms can render the exact message the
// FSDs specify ("Never silent, never lossy" — PRD §7).

export type ActionResult<T = void> =
  | { ok: true; data: T }
  | { ok: false; error: string };

export function ok<T>(data: T): ActionResult<T> {
  return { ok: true, data };
}

export function fail<T = void>(error: string): ActionResult<T> {
  return { ok: false, error };
}
