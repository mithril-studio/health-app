export type WorkoutStep = {
  text: string;
  duration: string | null;
  target: string;
};
export type WorkoutSection = {
  title: string;
  repeat: number | null;
  steps: WorkoutStep[];
};
const REPEAT = /^(.*?)\s*(\d+)\s*[x×]$/i;
// Kept verbatim: "10m" is minutes and "1km" is distance; never convert between them.
const DURATION = /^((?:\d+(?:[.,]\d+)?\s?(?:km|mi|h|m|s))+)\b\s*(.*)$/i;
/** Splits an Intervals.icu workout description into sections of "- " steps. */
export function parseWorkoutSteps(
  description: string,
): WorkoutSection[] | null {
  const sections: WorkoutSection[] = [];
  let hasSteps = false;
  for (const raw of description.split(/\r?\n/)) {
    const line = raw.trim();
    if (!line) continue;
    if (line.startsWith("- ")) {
      const text = line.slice(2).trim();
      const match = DURATION.exec(text);
      if (!sections.length)
        sections.push({ title: "", repeat: null, steps: [] });
      sections.at(-1)!.steps.push({
        text,
        duration: match ? match[1] : null,
        target: match ? match[2] : text,
      });
      hasSteps = true;
      continue;
    }
    const repeat = REPEAT.exec(line);
    sections.push(
      repeat
        ? { title: repeat[1], repeat: Number(repeat[2]), steps: [] }
        : { title: line, repeat: null, steps: [] },
    );
  }
  return hasSteps ? sections : null;
}
