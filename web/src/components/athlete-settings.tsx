"use client";

import { useState } from "react";
import { copy } from "@/lib/i18n";
import { AthleteScores } from "./athlete-scores";
import { WhoopConnection } from "./whoop-connection";
import { PageMenu, PagePanel, PageTabs } from "./page-menu";

export function AthleteSettings() {
  const [tab, setTab] = useState("scores");
  return (
    <>
      <PageMenu>
        <PageTabs
          prefix="settings"
          label={copy.nav.settings}
          value={tab}
          onChange={setTab}
          tabs={[
            { id: "scores", label: copy.scores.title },
            { id: "connections", label: copy.workouts.connections },
          ]}
        />
      </PageMenu>
      <PagePanel prefix="settings" id="scores" value={tab}>
        <AthleteScores />
      </PagePanel>
      <PagePanel prefix="settings" id="connections" value={tab}>
        <WhoopConnection />
      </PagePanel>
    </>
  );
}
