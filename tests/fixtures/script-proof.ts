import type { AdScript, Brief, Direction, Research, ScriptProofBrief } from "@/lib/types";

export const proof: ScriptProofBrief = {
  tension: "The host wants a finished Haldi corner without owning décor.",
  claim: "Haldi décor kit rentals include a marigold strand.",
  action: "Show a hand hanging a strand from the actual kit.",
  asset: "https://example.com/haldi-proof.jpg",
  offer: "$299 per weekend\nOrder 14+ days ahead",
  cta: "Help me choose",
};

export const brief: Brief = {
  objective: "Get kit inquiries", audience: "Anyone hosting Haldi at home", insight: proof.tension,
  offer: proof.offer, mandatories: ["Pay after approval"], kpi: "Cost per inquiry",
};

export const research: Research = {
  summary: "Weekend Haldi décor rentals.", audience: brief.audience, valueProps: [proof.claim], tone: "Warm",
  angles: [], sources: ["https://example.com/haldi"],
};

export const direction: Direction = {
  id: "dir-1", title: "The Haldi corner", angle: "Rent instead of owning", hook: "Don't buy it",
  visualPrompt: "Haldi corner", format: "video", script: "",
};

export const reference: AdScript = {
  id: "reference", framework: "Goal first", proofBrief: proof,
  hook: { visual: "Host holds a family photo against a bare living room wall.", spoken: "I want Haldi photos with Mum here.", onScreen: "A corner for Haldi" },
  beats: [
    { seconds: 3, visual: "Host holds a family photo against a bare living room wall.", vo: "I want Haldi photos with Mum here.", onScreen: "A corner for Haldi" },
    { seconds: 4, visual: "The host opens the rental kit.", vo: "Not buying décor. I'll rent it.", onScreen: "$299 per weekend" },
    { seconds: 4, visual: "A hand hangs the real marigold strand; the camera widens to reveal the finished corner.", vo: "Pay after approval.", onScreen: "Order 14+ days ahead" },
    { seconds: 4, visual: "The finished corner held in frame.", vo: "Tap Help me choose.", onScreen: "Help me choose" },
  ],
  cta: proof.cta,
};

export const crowded = {
  ...reference,
  id: "crowded",
  beats: reference.beats.map((b, i) => i === 1 ? {
    ...b,
    visual: "Unbox the kit, hang every strand, and reset the room.",
    vo: "Take the kit out and start hanging it before you have to do absolutely anything else.",
    onScreen: "$299 per weekend · Order 14 days ahead · Also see all service areas and pay after approval",
  } : i === 2 ? { ...b, onScreen: "" } : b),
};
