// One cohesive professional icon set (Lucide) replacing the mismatched OS emoji.
// NAMED re-exports only — never a barrel `import * as` — so the bundle tree-shakes
// to ~0.5KB per used glyph. Every icon paints via `currentColor`, so the amber /
// emerald theme flows straight in. Keep ♠♥♦♣ as TEXT on real card faces; the
// Lucide suit glyphs are for chrome/branding only.
export {
  Volume2,
  VolumeX,
  Mic,
  MicOff,
  Video,
  VideoOff,
  Palette,
  ScrollText,
  MessageSquare,
  Settings,
  Trophy,
  Crown,
  Medal,
  Rabbit,
  X,
  ArrowLeft,
  Download,
  LogOut, // stand up (vacate seat, keep watching)
  DoorOpen, // leave table (exit to home)
  Eye, // show cards (voluntary reveal after a hand)
  UserX, // kick (host moderation)
  Timer, // action clock / add time
  CircleDollarSign, // chips / rebuy
  MoreHorizontal, // "More" overflow menu
  Copy,
  Check,
  Play, // start game
  HelpCircle, // how-to-play / hand rankings
  BarChart3, // HUD stats overlay toggle
} from "lucide-react";

import type { SVGProps } from "react";

// The one glyph Lucide doesn't ship: the poker dealer button. A monoline "D" in a
// 2px ring, tuned to sit lightly on the dark felt beside the Lucide line weight.
export function DealerButton({
  size = 18,
  ...props
}: SVGProps<SVGSVGElement> & { size?: number }) {
  return (
    <svg
      width={size}
      height={size}
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth={1.75}
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden="true"
      {...props}
    >
      <circle cx="12" cy="12" r="9.25" />
      <path d="M9.4 7.6v8.8" />
      <path d="M9.4 7.6c4.1 0 5.7 2 5.7 4.4s-1.6 4.4-5.7 4.4" />
    </svg>
  );
}
