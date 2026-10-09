export type AthleteProfile = {
  goals: string;
  target_date: string | null;
  background: string;
  availability: string;
  other_sports: string;
  equipment: string;
  constraints: string;
  preferences: string;
  plan_context: string;
  updated_at: string | null;
  revision: number;
};
export type CoachingRecord = {
  id: string;
  kind: "observation" | "recommendation" | "question";
  status: "proposed" | "accepted" | "dismissed" | "completed";
  text: string;
  rationale: string;
  outcome: string;
  created_at: string;
  updated_at: string;
  revision: number;
};
