const palettes = [
  ["#6366f1", "#a855f7"],
  ["#0ea5e9", "#22d3ee"],
  ["#f97316", "#ef4444"],
  ["#10b981", "#84cc16"],
  ["#ec4899", "#f43f5e"],
];

export function placeholderImage(text: string, seed = 0): string {
  const [a, b] = palettes[seed % palettes.length];
  const safe = text.replace(/[<>&"]/g, "");
  const words = safe.split(" ");
  const lines: string[] = [];
  let line = "";
  for (const w of words) {
    if ((line + " " + w).trim().length > 18) {
      lines.push(line.trim());
      line = w;
    } else line += " " + w;
  }
  lines.push(line.trim());
  const tspans = lines.map((l, i) => `<tspan x="60" dy="${i === 0 ? 0 : 76}">${l}</tspan>`).join("");
  const svg = `<svg xmlns="http://www.w3.org/2000/svg" width="1080" height="1080"><defs><linearGradient id="g" x1="0" y1="0" x2="1" y2="1"><stop offset="0" stop-color="${a}"/><stop offset="1" stop-color="${b}"/></linearGradient></defs><rect width="1080" height="1080" fill="url(#g)"/><text x="60" y="480" font-family="Helvetica,Arial" font-size="68" font-weight="700" fill="white">${tspans}</text><text x="60" y="1010" font-family="Helvetica,Arial" font-size="28" fill="white" opacity="0.8">DEMO CREATIVE</text></svg>`;
  return `data:image/svg+xml;base64,${Buffer.from(svg).toString("base64")}`;
}
