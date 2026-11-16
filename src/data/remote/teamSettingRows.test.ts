import { describe, expect, it } from "vitest";
import { DEFAULT_CHECK_IN_MONTHS } from "@/data/pipeline/checkIns";
import { teamSettingFromRow, teamSettingToRow } from "./rows";

const base = {
  person_id: "p1",
  workspace_id: "w1",
  mg1_goal: 40,
  target_contact_to_meeting: null,
  target_meeting_to_plan: null,
  target_plan_to_registered: null,
  updated_at: "2026-11-01T00:00:00Z",
};
const none = {
  checkin_hot_months: null,
  checkin_warm_months: null,
  checkin_cold_months: null,
  checkin_not_interested_months: null,
};

describe("pipeline_team_settings rows with the check-in months", () => {
  it("reads the four as one set", () => {
    const s = teamSettingFromRow({
      ...base,
      checkin_hot_months: 1,
      checkin_warm_months: 2,
      checkin_cold_months: 24,
      checkin_not_interested_months: 36,
    });
    expect(s.checkIns).toEqual({ hot: 1, warm: 2, cold: 24, notInterested: 36 });
    expect(s).toMatchObject({ personId: "p1", mg1Goal: 40, targets: null });
  });

  it("a row with none of them (or an older row without the columns) has no set", () => {
    expect(teamSettingFromRow({ ...base, ...none }).checkIns).toBeNull();
    expect(teamSettingFromRow({ ...base }).checkIns).toBeNull();
  });

  it("a half-filled row (the database refuses one) is read as none, never mixed", () => {
    expect(teamSettingFromRow({ ...base, ...none, checkin_hot_months: 3 }).checkIns).toBeNull();
    expect(
      teamSettingFromRow({ ...base, ...none, checkin_cold_months: 12, checkin_warm_months: 6 })
        .checkIns,
    ).toBeNull();
  });

  it("writes the four columns (null when unset), without the stamped updated_at", () => {
    const set = { hot: 3, warm: 6, cold: 12, notInterested: 12 };
    expect(
      teamSettingToRow({
        personId: "p1",
        mg1Goal: null,
        targets: null,
        checkIns: set,
        updatedAt: "x",
      }),
    ).toMatchObject({
      person_id: "p1",
      checkin_hot_months: 3,
      checkin_warm_months: 6,
      checkin_cold_months: 12,
      checkin_not_interested_months: 12,
    });
    const cleared = teamSettingToRow({
      personId: "p1",
      mg1Goal: 5,
      targets: null,
      checkIns: null,
      updatedAt: "x",
    });
    expect(cleared).toMatchObject({ ...none, mg1_goal: 5 });
    expect(cleared).not.toHaveProperty("updated_at");
    expect(
      teamSettingToRow({ personId: "p", mg1Goal: null, targets: null, updatedAt: "x" }),
    ).toMatchObject(none);
  });

  it("round-trips", () => {
    const s = {
      personId: "p1",
      mg1Goal: null,
      targets: null,
      checkIns: { ...DEFAULT_CHECK_IN_MONTHS, hot: 1 },
      updatedAt: "2026-11-01T00:00:00.000Z",
    };
    const back = teamSettingFromRow({ ...base, mg1_goal: null, ...teamSettingToRow(s) } as never);
    expect(back.checkIns).toEqual(s.checkIns);
  });
});
