// Positions for seats around the oval table. The hero (the viewer's own seat)
// is rotated to bottom-center; everyone else fans out around the table.

export interface SeatPos {
  seat: number; // actual seat index
  x: number; // % of table width (center of pod)
  y: number; // % of table height
  betX: number; // bet-chips position, pulled toward center
  betY: number;
}

export function seatPositions(maxSeats: number, heroSeat: number | null): SeatPos[] {
  const hero = heroSeat ?? 0;
  // A pod is ~128px wide on the 1000px design box (≈6.4% half-width). Keeping the
  // horizontal radius at 47 pushed the side seats to ~53% of center → their pods
  // overflowed the felt: off-screen on the left, under the side panel on the
  // right. 43 keeps the widest pod (sin≈1) inside the box while still sitting on
  // the rail.
  const Rx = 41;
  // Vertical radius is kept a little tighter than horizontal so the bottom seat's
  // pod + its status pill (and the top seats' cards) stay inside the felt's
  // rounded top/bottom edges instead of spilling into the dark gutter.
  const Ry = 39;
  const betRx = 28;
  const betRy = 26;
  const out: SeatPos[] = [];
  for (let seat = 0; seat < maxSeats; seat++) {
    const v = (seat - hero + maxSeats) % maxSeats; // visual index, 0 = bottom
    const theta = (v / maxSeats) * Math.PI * 2;
    const sin = Math.sin(theta);
    const cos = Math.cos(theta);
    // x is mirrored (50 - Rx·sin) so that the next seat in engine order — the
    // button, blinds, and turn all advance by increasing seat index — moves
    // CLOCKWISE on screen (bottom → screen-left → top → screen-right), i.e. to
    // the hero's left, exactly like a real table viewed from above (KR2).
    out.push({
      seat,
      x: 50 - Rx * sin,
      y: 50 + Ry * cos,
      betX: 50 - betRx * sin,
      betY: 50 + betRy * cos,
    });
  }
  return out;
}
