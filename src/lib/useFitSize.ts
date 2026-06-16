import { useLayoutEffect, useRef, useState } from "react";

// The table is laid out at a fixed *design* size (seat %s, pods, cards are all
// authored against it) and then uniformly scaled with a CSS transform to fit
// whatever space it's given. Scaling the whole thing — rather than each element
// — keeps the proportions identical on a phone and a desktop and guarantees
// nothing ever overflows. We pick a landscape or portrait design box depending
// on the container's orientation so a tall phone gets a tall table.
export interface TableFit {
  scale: number;
  base: { w: number; h: number };
  offsetY: number; // screen px — balances the asymmetric pod overhang headroom
}

const LANDSCAPE = { w: 1000, h: 620 };
const PORTRAIT = { w: 640, h: 900 };
// A flatter, wider design box for wide viewports (desktop, widescreen, landscape
// tablet/phone). A tall 1.61 oval gets height-pinned on a 16:9/16:10 area and
// leaves big horizontal dead margins; this ~2:1 box lets the felt grow to fill
// the width (a realistic wide poker oval) instead of letterboxing.
const WIDE = { w: 1000, h: 520 };
// Even flatter for very short areas (landscape phone), which are height-bound:
// a shorter design box lets the felt grow wider into the available width.
const WIDE_SHORT = { w: 1000, h: 400 };

// Seat pods overhang the design box: opponent cards rise ABOVE the top seats and
// the hero's pod + its last-action/win badge hang BELOW the bottom seat. The
// table is clipped (overflow-hidden) to its container, so when the scaled design
// box nearly fills the area this overhang is cut off — the hero's own cards/label
// clipped on short desktops (B1). Reserve a little vertical headroom (in design
// px) on each edge so the box never butts the clip boundary, biased to the larger
// top (card) overhang and nudged down to balance it. Constants are absolute pod
// px, so the same values are correct for both the landscape and portrait box.
const PAD_TOP = 40;
const PAD_BOTTOM = 44;

export function useFitSize() {
  const ref = useRef<HTMLDivElement>(null);
  const [fit, setFit] = useState<TableFit>({ scale: 0, base: LANDSCAPE, offsetY: 0 });

  useLayoutEffect(() => {
    const el = ref.current;
    if (!el) return;
    const measure = () => {
      const cw = el.clientWidth;
      const ch = el.clientHeight;
      if (cw === 0 || ch === 0) return;
      // portrait when clearly taller than wide; the flat WIDE box whenever the
      // area is meaningfully wider than tall (desktop/widescreen/landscape) so the
      // felt fills the width; the 1.61 LANDSCAPE box only for near-square areas.
      const base =
        ch > cw * 1.1 ? PORTRAIT : ch < 420 ? WIDE_SHORT : cw > ch * 1.5 ? WIDE : LANDSCAPE;
      // Fit against an inflated height so the reserved headroom is never eaten by
      // a height-bound scale; then center+nudge so each edge keeps its reserve.
      const effectiveH = base.h + PAD_TOP + PAD_BOTTOM;
      const scale = Math.min(cw / base.w, ch / effectiveH);
      const offsetY = ((PAD_TOP - PAD_BOTTOM) / 2) * scale;
      setFit({ scale, base, offsetY });
    };
    measure();
    const ro = new ResizeObserver(measure);
    ro.observe(el);
    return () => ro.disconnect();
  }, []);

  return { ref, fit };
}
