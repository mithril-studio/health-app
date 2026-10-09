export type CoachMode = "chat" | "workout" | "daily" | "weekly";
export function coachMode(value: string | null): CoachMode {
  return value === "daily" || value === "weekly" || value === "workout"
    ? value
    : "chat";
}
export const taskCopy = {
  label: "Coaching task",
  chat: "Chat",
  daily: "Daily guidance",
  weekly: "Weekly review",
  workout: "Workout review",
  review: "Review with coach",
  advice: "Advice only. Your calendar will not be changed.",
  selected: "Selected workout",
  missing: "Open a workout and choose Review with coach to select it.",
  prompts: {
    chat: "",
    daily: "What training would you recommend today, and why?",
    weekly: "Review my training week and recommend priorities for next week.",
    workout: "Review this workout and suggest what I should learn from it.",
  },
};
