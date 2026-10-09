"use client";
import { useState } from "react";
import { CoachingRecords } from "./coaching-records";
import { AthleteProfile } from "./athlete-profile";
import { PageMenu, PagePanel, PageTabs } from "./page-menu";
import { athleteCopy as c } from "@/lib/athlete-copy";
import { copy } from "@/lib/i18n";
import "./athlete.css";
export function Athlete() {
  const [tab, setTab] = useState("profile");
  return (
    <>
      <PageMenu>
        <PageTabs
          prefix="athlete"
          label={copy.nav.athlete}
          value={tab}
          onChange={setTab}
          tabs={[
            { id: "profile", label: c.profile },
            { id: "records", label: c.records },
          ]}
        />
      </PageMenu>
      <PagePanel prefix="athlete" id="profile" value={tab}>
        <AthleteProfile />
      </PagePanel>
      <PagePanel prefix="athlete" id="records" value={tab}>
        <CoachingRecords />
      </PagePanel>
    </>
  );
}
