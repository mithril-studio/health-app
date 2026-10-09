"use client";

import { copy } from "@/lib/i18n";
import { AthleteScores } from "./athlete-scores";
import { PageMenu, PagePanel, PageTabs } from "./page-menu";

export function AthleteSettings() {
  return (
    <>
      <PageMenu>
        <PageTabs
          prefix="settings"
          label={copy.nav.settings}
          value="scores"
          onChange={() => {}}
          tabs={[{ id: "scores", label: copy.scores.title }]}
        />
      </PageMenu>
      <PagePanel prefix="settings" id="scores" value="scores">
        <AthleteScores />
      </PagePanel>
    </>
  );
}
