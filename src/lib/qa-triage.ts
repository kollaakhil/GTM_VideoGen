/**
 * Sorts vision-QA notes on a static ad by who can fix them. When the headline, offer, CTA and footer are typeset in
 * code, notes about that text can only be fixed by re-typesetting (free); sending them to the image model just buys
 * another render that cannot change the text. Only notes about the photo itself go back to the image model.
 */
export type QATriage = { typeset: string[]; picture: string[] };

/** Bookkeeping lines the pipeline adds to QA notes; they are not fixes. */
const META = /^(best of \d+ takes|auto-fixed|auto-retypeset|filmstrip qa|demo score)/i;

/** Text the image model painted into the scene (it was told not to), so a new render is the fix. */
const PICTURE_TEXT = /\b(packag\w*|label\w*|sign(s|age)?|garbled|gibberish|stray (text|letters)|background text|text (in|on) the (scene|photo|product|background|box|bag)|letters? (in|on) the (scene|photo|product|background))\b/i;

/** Layout and wording of the code-typeset overlay. */
const TYPESET = /\b(headline|offer( line| text)?|cta|call[- ]to[- ]action|button|footer|tagline|overlay|typeset\w*|typograph\w*|font|kerning|line break|wrap\w*|cut[- ]off|cut mid|truncat\w*|overflow\w*|off the (right |left )?edge|runs? (off|past)|spills?|clipped|legib\w*|readab\w*|text (size|placement|layout|contrast|block)|on-image text|copy (is|runs|gets)|misspel\w*|typo)\b/i;

export function triageNotes(notes: string[]): QATriage {
  const out: QATriage = { typeset: [], picture: [] };
  for (const raw of notes) {
    const n = raw.trim();
    if (!n || META.test(n)) continue;
    if (!PICTURE_TEXT.test(n) && TYPESET.test(n)) out.typeset.push(n);
    else out.picture.push(n);
  }
  return out;
}

export type FixPlan = { rerender: boolean; imageFixes: string[]; retypeset: boolean };

/**
 * Decides the next auto-fix step. `typesetInCode` is true when the ad's text is laid out by typesetStatic (the image
 * model drew no text); otherwise every note is about pixels the image model produced.
 */
export function planFix(notes: string[], typesetInCode: boolean): FixPlan {
  if (!typesetInCode) {
    const all = notes.filter((n) => n.trim() && !META.test(n.trim()));
    return { rerender: true, imageFixes: all, retypeset: false };
  }
  const t = triageNotes(notes);
  return { rerender: t.picture.length > 0, imageFixes: t.picture, retypeset: t.typeset.length > 0 };
}
