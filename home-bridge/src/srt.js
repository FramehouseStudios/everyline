// Minimal SRT parser: "HH:MM:SS,mmm --> HH:MM:SS,mmm" blocks into
// normalized cues { id, startMs, endMs, text }. Strips inline tags.
// Unknown shapes are skipped, never mistimed.

function toMs(h, m, s, ms) {
  const milli = Number(String(ms).padEnd(3, '0').slice(0, 3));
  return (Number(h) * 3600 + Number(m) * 60 + Number(s)) * 1000 + milli;
}

const STAMP =
  /(\d+):(\d+):(\d+)[,.](\d+)\s*-->\s*(\d+):(\d+):(\d+)[,.](\d+)/;

export function parseSrt(text) {
  const cues = [];
  const blocks = String(text).replace(/\r/g, '').split(/\n\s*\n/);
  let n = 0;
  for (const block of blocks) {
    const lines = block.trim().split('\n');
    if (lines.length < 2) continue;
    let i = 0;
    if (/^\d+$/.test(lines[0].trim())) i = 1; // numeric index line
    const m = lines[i] ? lines[i].match(STAMP) : null;
    if (!m) continue;
    const startMs = toMs(m[1], m[2], m[3], m[4]);
    const endMs = toMs(m[5], m[6], m[7], m[8]);
    const cueText = lines
      .slice(i + 1)
      .join('\n')
      .replace(/<[^>]+>/g, '')
      .trim();
    if (!cueText || !(endMs > startMs)) continue;
    cues.push({ id: `cue-${n++}`, startMs, endMs, text: cueText });
  }
  return cues.sort((a, b) => a.startMs - b.startMs);
}
