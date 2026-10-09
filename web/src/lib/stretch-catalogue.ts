export type Focus = "full" | "legs" | "hips" | "back" | "upper";
export type StretchStep = { name: string; hint: string; seconds: number };
export type StretchRoutine = {
  id: string;
  name: string;
  focus: Focus;
  when: string;
  steps: StretchStep[];
};

function sided(
  base: string,
  hint: (side: "left" | "right") => string,
  seconds: number,
): StretchStep[] {
  return [
    { name: `${base} · left`, hint: hint("left"), seconds },
    { name: `${base} · right`, hint: hint("right"), seconds },
  ];
}

export const stretchRoutines: StretchRoutine[] = [
  {
    id: "everyday-reset",
    name: "Everyday reset",
    focus: "full",
    when: "Anytime you have five minutes",
    steps: [
      {
        name: "Calf · left",
        hint: "Hands on a wall, left leg behind you. Keep your heel down and lean gently forward.",
        seconds: 30,
      },
      {
        name: "Calf · right",
        hint: "Switch legs. Keep your back heel down and your toes pointing forward.",
        seconds: 30,
      },
      {
        name: "Hip flexor · left",
        hint: "Kneel on your left knee with your right foot in front. Stay tall and shift gently forward.",
        seconds: 30,
      },
      {
        name: "Hip flexor · right",
        hint: "Switch sides. Keep your torso upright and avoid arching your lower back.",
        seconds: 30,
      },
      {
        name: "Hamstring · left",
        hint: "Sit with your left leg extended and right leg bent. Hinge forward gently from your hips.",
        seconds: 30,
      },
      {
        name: "Hamstring · right",
        hint: "Switch legs. Keep your back long; a small movement is enough.",
        seconds: 30,
      },
      {
        name: "Figure four · left",
        hint: "Lie on your back. Cross your left ankle over your right thigh and draw the legs gently toward you.",
        seconds: 30,
      },
      {
        name: "Figure four · right",
        hint: "Switch sides. Relax your shoulders and keep breathing.",
        seconds: 30,
      },
      {
        name: "Chest opening",
        hint: "Stand tall with your hands loosely joined behind you. Gently open your chest without forcing your arms.",
        seconds: 30,
      },
      {
        name: "Child’s pose",
        hint: "Kneel and sit back toward your heels. Reach your arms forward as far as feels comfortable.",
        seconds: 30,
      },
    ],
  },
  {
    id: "full-body-unwind",
    name: "Full-body unwind",
    focus: "full",
    when: "An evening reset when you have ten minutes",
    steps: [
      ...sided(
        "Neck side stretch",
        (s) => `Tilt your ear toward your ${s} shoulder. Let the opposite shoulder relax down.`,
        60,
      ),
      ...sided(
        "Cross-body shoulder",
        (s) => `Draw your ${s} arm across your chest with the other hand. Keep both shoulders down.`,
        60,
      ),
      ...sided(
        "Standing side bend",
        (s) => `Reach your ${s} arm overhead and lean away from that side. Keep your hips stacked.`,
        60,
      ),
      ...sided(
        "Quad",
        (s) => `Standing on your ${s === "left" ? "right" : "left"} leg, hold your ${s} ankle and draw your heel toward your seat.`,
        60,
      ),
      ...sided(
        "Seated spinal twist",
        (s) => `Sit tall and rotate gently toward your ${s}. Use your breath to deepen the turn.`,
        60,
      ),
    ],
  },
  {
    id: "pre-run-activation",
    name: "Pre-run activation",
    focus: "legs",
    when: "Before you head out for a run",
    steps: [
      ...sided(
        "Leg swings",
        (s) => `Hold something stable and swing your ${s} leg forward and back, staying controlled.`,
        30,
      ),
      ...sided(
        "Walking lunges",
        (s) => `Step forward into a lunge leading with your ${s} leg, then rise and reset.`,
        30,
      ),
      {
        name: "High knees",
        hint: "Drive your knees up at a light jog, staying tall through your torso.",
        seconds: 30,
      },
      {
        name: "Butt kicks",
        hint: "Jog lightly, flicking your heels up toward your seat.",
        seconds: 30,
      },
      {
        name: "Ankle bounces",
        hint: "Small, quick bounces on the balls of your feet to wake up your calves.",
        seconds: 30,
      },
      {
        name: "Arm circles",
        hint: "Loosen your shoulders with big, slow circles, then reverse direction.",
        seconds: 30,
      },
    ],
  },
  {
    id: "post-run-legs",
    name: "Post-run legs",
    focus: "legs",
    when: "Right after a run, while your muscles are warm",
    steps: [
      ...sided(
        "Calf",
        (s) => `Hands on a wall, ${s} leg behind you. Keep your heel down and lean gently forward.`,
        45,
      ),
      ...sided(
        "Quad",
        (s) => `Standing on your ${s === "left" ? "right" : "left"} leg, hold your ${s} ankle and draw your heel toward your seat.`,
        45,
      ),
      ...sided(
        "Hamstring",
        (s) => `Sit with your ${s} leg extended and the other bent. Hinge forward gently from your hips.`,
        45,
      ),
      ...sided(
        "Hip flexor",
        (s) => `Kneel on your ${s} knee with the other foot in front. Stay tall and shift gently forward.`,
        45,
      ),
    ],
  },
  {
    id: "post-soccer-recovery",
    name: "Post-soccer recovery",
    focus: "legs",
    when: "After a match or a hard session",
    steps: [
      ...sided(
        "Adductor",
        (s) => `Step your ${s} leg out to the side and bend that knee, keeping the other leg straight.`,
        45,
      ),
      ...sided(
        "Quad",
        (s) => `Standing on your ${s === "left" ? "right" : "left"} leg, hold your ${s} ankle and draw your heel toward your seat.`,
        45,
      ),
      ...sided(
        "Glute · figure four",
        (s) => `Lie on your back, cross your ${s} ankle over the other thigh, and draw the legs gently toward you.`,
        45,
      ),
      ...sided(
        "Calf",
        (s) => `Hands on a wall, ${s} leg behind you. Keep your heel down and lean gently forward.`,
        45,
      ),
    ],
  },
  {
    id: "hips-lower-back",
    name: "Hips & lower back",
    focus: "hips",
    when: "When your hips or lower back feel tight",
    steps: [
      ...sided(
        "Figure four",
        (s) => `Lie on your back, cross your ${s} ankle over the other thigh, and draw the legs gently toward you.`,
        45,
      ),
      ...sided(
        "Hip flexor",
        (s) => `Kneel on your ${s} knee with the other foot in front. Stay tall and shift gently forward.`,
        45,
      ),
      ...sided(
        "Knee to chest",
        (s) => `Lying on your back, draw your ${s} knee toward your chest and hold.`,
        45,
      ),
      {
        name: "Cat-cow",
        hint: "On hands and knees, alternate arching and rounding your spine with your breath.",
        seconds: 45,
      },
      {
        name: "Seated forward fold",
        hint: "Sit with both legs extended and hinge gently forward from your hips.",
        seconds: 45,
      },
    ],
  },
  {
    id: "desk-neck-shoulders",
    name: "Desk break: neck & shoulders",
    focus: "upper",
    when: "A short reset between meetings",
    steps: [
      ...sided(
        "Neck tilt",
        (s) => `Tilt your ear toward your ${s} shoulder. Let the opposite shoulder relax down.`,
        30,
      ),
      {
        name: "Shoulder rolls",
        hint: "Roll your shoulders back and down in slow, full circles.",
        seconds: 30,
      },
      {
        name: "Chest opening",
        hint: "Clasp your hands loosely behind you and gently open your chest.",
        seconds: 30,
      },
      ...sided(
        "Upper trap",
        (s) => `Gently draw your head toward your ${s === "left" ? "right" : "left"} armpit to stretch the ${s} side of your neck.`,
        30,
      ),
      ...sided(
        "Wrist",
        (s) => `Extend your ${s} arm and gently pull your fingers back, then let them curl under.`,
        30,
      ),
    ],
  },
  {
    id: "shoulders-upper-back",
    name: "Shoulders & upper back",
    focus: "upper",
    when: "After a swim, paddle, or upper-body session",
    steps: [
      ...sided(
        "Cross-body shoulder",
        (s) => `Draw your ${s} arm across your chest with the other hand. Keep both shoulders down.`,
        45,
      ),
      ...sided(
        "Triceps",
        (s) => `Reach your ${s} arm overhead, bend the elbow, and gently press down with the other hand.`,
        45,
      ),
      {
        name: "Chest opening",
        hint: "Clasp your hands loosely behind you and gently open your chest.",
        seconds: 45,
      },
      {
        name: "Doorway chest stretch",
        hint: "Place your forearm on a doorframe and step gently through until you feel a stretch across your chest.",
        seconds: 45,
      },
      {
        name: "Child’s pose",
        hint: "Kneel and sit back toward your heels. Reach your arms forward as far as feels comfortable.",
        seconds: 45,
      },
      {
        name: "Neck release",
        hint: "Let your chin drop gently toward your chest and roll slowly from side to side.",
        seconds: 45,
      },
    ],
  },
  {
    id: "morning-mobility",
    name: "Morning mobility",
    focus: "full",
    when: "First thing in the morning",
    steps: [
      {
        name: "Cat-cow",
        hint: "On hands and knees, alternate arching and rounding your spine with your breath.",
        seconds: 30,
      },
      {
        name: "Child’s pose",
        hint: "Kneel and sit back toward your heels. Reach your arms forward as far as feels comfortable.",
        seconds: 30,
      },
      ...sided(
        "Standing side bend",
        (s) => `Reach your ${s} arm overhead and lean away from that side. Keep your hips stacked.`,
        30,
      ),
      {
        name: "Forward fold",
        hint: "Let your head hang and sway gently, keeping a soft bend in your knees.",
        seconds: 30,
      },
      {
        name: "Hip circles",
        hint: "Hands on your hips, draw slow, wide circles in each direction.",
        seconds: 30,
      },
      {
        name: "Neck rolls",
        hint: "Gently roll your head in a slow half-circle from shoulder to shoulder.",
        seconds: 30,
      },
      {
        name: "Shoulder rolls",
        hint: "Roll your shoulders back and down in slow, full circles.",
        seconds: 30,
      },
    ],
  },
  {
    id: "bedtime-wind-down",
    name: "Bedtime wind-down",
    focus: "back",
    when: "Before sleep",
    steps: [
      {
        name: "Seated forward fold",
        hint: "Sit with both legs extended and hinge gently forward from your hips.",
        seconds: 45,
      },
      ...sided(
        "Figure four",
        (s) => `Lie on your back, cross your ${s} ankle over the other thigh, and draw the legs gently toward you.`,
        45,
      ),
      {
        name: "Child’s pose",
        hint: "Kneel and sit back toward your heels. Reach your arms forward as far as feels comfortable.",
        seconds: 45,
      },
      {
        name: "Legs up the wall",
        hint: "Lie on your back with your legs resting up a wall. Let your breathing slow down.",
        seconds: 45,
      },
      ...sided(
        "Gentle spinal twist",
        (s) => `Lying on your back, let your knees fall toward your ${s} and look toward the other side.`,
        45,
      ),
      {
        name: "Neck release",
        hint: "Let your chin drop gently toward your chest and roll slowly from side to side.",
        seconds: 45,
      },
    ],
  },
  {
    id: "after-strength-training",
    name: "After strength training",
    focus: "full",
    when: "Once you’ve put your weights away",
    steps: [
      {
        name: "Chest opening",
        hint: "Clasp your hands loosely behind you and gently open your chest.",
        seconds: 45,
      },
      ...sided(
        "Lat",
        (s) => `Reach your ${s} arm overhead and lean away to the opposite side, feeling the stretch along your ${s} side.`,
        45,
      ),
      ...sided(
        "Quad",
        (s) => `Standing on your ${s === "left" ? "right" : "left"} leg, hold your ${s} ankle and draw your heel toward your seat.`,
        45,
      ),
      ...sided(
        "Hamstring",
        (s) => `Sit with your ${s} leg extended and the other bent. Hinge forward gently from your hips.`,
        45,
      ),
      ...sided(
        "Cross-body shoulder",
        (s) => `Draw your ${s} arm across your chest with the other hand. Keep both shoulders down.`,
        45,
      ),
      ...sided(
        "Hip flexor",
        (s) => `Kneel on your ${s} knee with the other foot in front. Stay tall and shift gently forward.`,
        45,
      ),
      {
        name: "Child’s pose",
        hint: "Kneel and sit back toward your heels. Reach your arms forward as far as feels comfortable.",
        seconds: 45,
      },
    ],
  },
  {
    id: "ankles-feet",
    name: "Ankles & feet",
    focus: "legs",
    when: "Barefoot or in socks, anytime",
    steps: [
      ...sided(
        "Ankle circles",
        (s) => `Lift your ${s} foot and draw slow circles with your ankle in each direction.`,
        30,
      ),
      {
        name: "Toe raises",
        hint: "Standing tall, lift your toes off the floor while keeping your heels down.",
        seconds: 30,
      },
      ...sided(
        "Calf",
        (s) => `Hands on a wall, ${s} leg behind you. Keep your heel down and lean gently forward.`,
        30,
      ),
      ...sided(
        "Plantar fascia roll",
        (s) => `Roll the arch of your ${s} foot over a ball or bottle with gentle pressure.`,
        30,
      ),
      {
        name: "Ankle flexion",
        hint: "Sitting down, point and flex both feet slowly, feeling the stretch through your shins and calves.",
        seconds: 30,
      },
    ],
  },
  {
    id: "deep-flexibility",
    name: "Deep flexibility",
    focus: "full",
    when: "When you want a longer, slower practice",
    steps: [
      ...sided(
        "Hamstring",
        (s) => `Sit with your ${s} leg extended and the other bent. Hinge forward gently from your hips.`,
        60,
      ),
      ...sided(
        "Quad",
        (s) => `Standing on your ${s === "left" ? "right" : "left"} leg, hold your ${s} ankle and draw your heel toward your seat.`,
        60,
      ),
      ...sided(
        "Hip flexor",
        (s) => `Kneel on your ${s} knee with the other foot in front. Stay tall and shift gently forward.`,
        60,
      ),
      ...sided(
        "Glute · figure four",
        (s) => `Lie on your back, cross your ${s} ankle over the other thigh, and draw the legs gently toward you.`,
        60,
      ),
      ...sided(
        "Calf",
        (s) => `Hands on a wall, ${s} leg behind you. Keep your heel down and lean gently forward.`,
        60,
      ),
      ...sided(
        "Adductor",
        (s) => `Step your ${s} leg out to the side and bend that knee, keeping the other leg straight.`,
        60,
      ),
      ...sided(
        "Lat side bend",
        (s) => `Reach your ${s} arm overhead and lean away from that side. Keep your hips stacked.`,
        60,
      ),
      ...sided(
        "Cross-body shoulder",
        (s) => `Draw your ${s} arm across your chest with the other hand. Keep both shoulders down.`,
        60,
      ),
      ...sided(
        "Seated spinal twist",
        (s) => `Sit tall and rotate gently toward your ${s}. Use your breath to deepen the turn.`,
        60,
      ),
      {
        name: "Chest opening",
        hint: "Clasp your hands loosely behind you and gently open your chest.",
        seconds: 60,
      },
      {
        name: "Child’s pose",
        hint: "Kneel and sit back toward your heels. Reach your arms forward as far as feels comfortable.",
        seconds: 60,
      },
    ],
  },
];

export function routineById(id: string) {
  return stretchRoutines.find((r) => r.id === id);
}

export function routineSeconds(routine: StretchRoutine) {
  return routine.steps.reduce((total, step) => total + step.seconds, 0);
}
