// Single source of truth for rendering chip amounts. The game tracks chips as
// plain integers; these helpers add the $ + thousands separators (and a compact
// felt form) so every surface reads money the same way. Editable numeric inputs
// (bet amount, buy-in) are deliberately left raw — formatting would break
// type="number" parsing.

// Full form: "$1,234", "$1,234.50" (cents shown only when the value is
// fractional). Negatives render as "-$1,234" (sign outside the $).
export function fmtMoney(n: number): string {
  if (!Number.isFinite(n)) return "$0";
  const neg = n < 0;
  const abs = Math.abs(n);
  const hasCents = Math.round(abs * 100) % 100 !== 0;
  const body = abs.toLocaleString("en-US", {
    minimumFractionDigits: hasCents ? 2 : 0,
    maximumFractionDigits: 2,
  });
  return `${neg ? "-" : ""}$${body}`;
}

// Compact form for the crowded felt (pots, bet chips, seat stacks):
// "$1.2k", "$3.4M". Falls back to fmtMoney under 1,000 so small stakes stay
// exact.
export function fmtChips(n: number): string {
  if (!Number.isFinite(n)) return "$0";
  const neg = n < 0;
  const abs = Math.abs(n);
  if (abs < 1000) return fmtMoney(n);
  const units: [number, string][] = [
    [1e9, "B"],
    [1e6, "M"],
    [1e3, "k"],
  ];
  for (const [div, suffix] of units) {
    if (abs >= div) {
      const v = abs / div;
      const s = v >= 100 ? Math.round(v).toString() : v.toFixed(1);
      return `${neg ? "-" : ""}$${s}${suffix}`;
    }
  }
  return fmtMoney(n);
}

// Big-blind equivalent of a chip amount, for the bet/call/pot readouts pros
// think in: "6 BB", "2.5 BB". One decimal under 10 BB, whole numbers above.
// Returns "" when there is no usable big blind so callers can omit it cleanly.
export function fmtBB(chips: number, bb: number): string {
  if (!bb || !Number.isFinite(bb) || !Number.isFinite(chips)) return "";
  const n = chips / bb;
  const s = n >= 10 ? Math.round(n).toString() : (Math.round(n * 10) / 10).toString();
  return `${s} BB`;
}

// Signed net for win/loss badges: "+$1.2k" / "-$340". Compact form, with the
// sign prefixed so we never get "--$340".
export function fmtNet(n: number): string {
  const s = fmtChips(Math.abs(n));
  if (n > 0) return `+${s}`;
  if (n < 0) return `-${s}`;
  return s; // "$0"
}
