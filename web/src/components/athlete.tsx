"use client";
import { AthleteProfile } from "./athlete-profile";
import { PageMenu, PagePanel, PageTabs } from "./page-menu";
import { athleteCopy as c } from "@/lib/athlete-copy";
import { copy } from "@/lib/i18n";
import "./athlete.css";
export function Athlete() {
  return (
    <>
      <PageMenu>
        <PageTabs
          prefix="athlete"
          label={copy.nav.athlete}
          value="profile"
          onChange={() => {}}
          tabs={[{ id: "profile", label: c.profile }]}
        />
      </PageMenu>
      <PagePanel prefix="athlete" id="profile" value="profile">
        <AthleteProfile />
      </PagePanel>
    </>
  );
}
