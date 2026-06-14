import type { HandSummary, LedgerEntry, LogEntry } from "@common/protocol";
import { cardCode } from "@common/cards";

function triggerDownload(filename: string, content: string, type: string) {
  const blob = new Blob([content], { type });
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = filename;
  document.body.appendChild(a);
  a.click();
  a.remove();
  setTimeout(() => URL.revokeObjectURL(url), 1000);
}

export function downloadLedgerCsv(roomId: string, ledger: LedgerEntry[]) {
  const rows = [
    ["player", "buy_in", "stack", "net"],
    ...ledger.map((l) => [l.name, String(l.buyIn), String(l.stack), String(l.net)]),
  ];
  const csv = rows.map((r) => r.map((c) => `"${c.replace(/"/g, '""')}"`).join(",")).join("\n");
  triggerDownload(`${roomId}-ledger.csv`, csv, "text/csv");
}

export function downloadLogText(roomId: string, histories: HandSummary[], log: LogEntry[]) {
  const lines: string[] = [`Session log — room ${roomId.toUpperCase()}`, ""];
  if (histories.length) {
    for (const h of histories) {
      lines.push(`──── Hand #${h.handNumber} ────`);
      lines.push(...h.actions);
      for (const b of h.boards) if (b.length) lines.push(`Board: ${b.map(cardCode).join(" ")}`);
      const shown = h.players.filter((p) => p.holeCards);
      for (const p of shown) lines.push(`${p.name}: ${p.holeCards!.map(cardCode).join(" ")}`);
      lines.push("");
    }
  } else {
    lines.push(...log.map((l) => l.text));
  }
  triggerDownload(`${roomId}-log.txt`, lines.join("\n"), "text/plain");
}

export function downloadSessionJson(
  roomId: string,
  ledger: LedgerEntry[],
  histories: HandSummary[]
) {
  const payload = {
    room: roomId,
    exportedAt: new Date().toISOString(),
    ledger,
    hands: histories.map((h) => ({
      ...h,
      boards: h.boards.map((b) => b.map(cardCode)),
      players: h.players.map((p) => ({
        ...p,
        holeCards: p.holeCards ? p.holeCards.map(cardCode) : null,
      })),
    })),
  };
  triggerDownload(`${roomId}-session.json`, JSON.stringify(payload, null, 2), "application/json");
}
