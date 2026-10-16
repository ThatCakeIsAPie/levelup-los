/**
 * Referrals: writes (re-exported from "@/data"). With real accounts the links
 * are plain column edits on `people` and `list_entries`; the database checks
 * that the referrer is someone the writer can see.
 */
import { usePeopleStore } from "@/stores/peopleStore";
import { logPerson } from "@/stores/activityStore";
import { getViewer } from "../session";
import { updateCustomerPipeline, customerPipeline } from "../customerPipeline/store";
import { currentReferralIndex } from "./hooks";
import { NO_LINKS, referralError, referralWrites, type Ref, type ReferralLinks } from "./rules";

const now = () => new Date().toISOString();

function linksOf(ref: Ref): ReferralLinks {
  if (ref.kind === "person") {
    const p = usePeopleStore.getState().people.find((x) => x.id === ref.id);
    return { referredBy: p?.referredBy ?? null, referredByEntry: p?.referredByEntry ?? null };
  }
  const e = customerPipeline().entries.find((x) => x.id === ref.id);
  return e ? { referredBy: e.referredBy, referredByEntry: e.referredByEntry } : { ...NO_LINKS };
}

function writeLinks(ref: Ref, links: ReferralLinks): void {
  if (ref.kind === "person") {
    const cur = linksOf(ref);
    if (cur.referredBy === links.referredBy && cur.referredByEntry === links.referredByEntry)
      return;
    // A plain edit, logged in words ("Updated who referred them" on the profile).
    usePeopleStore.setState((st) => ({
      people: st.people.map((p) =>
        p.id === ref.id ? { ...p, ...links, lastUpdatedAt: now() } : p,
      ),
    }));
    logPerson("updated", ref.id, "Edited who referred them");
    return;
  }
  updateCustomerPipeline((s) => ({
    entries: s.entries.map((e) => (e.id === ref.id ? { ...e, ...links, updatedAt: now() } : e)),
  }));
}

export type ReferralResult = { ok: true; undo: () => void } | { ok: false; error: string };

/**
 * Record who referred a person or list name (`referrer` null: nobody). The
 * link goes on the contact's name on a list when it has one, else on the
 * person; other rows of the same contact lose theirs, so it has one referrer.
 * Returns an undo.
 */
export function setReferredBy(target: Ref, referrer: Ref | null): ReferralResult {
  const viewer = getViewer();
  if (!viewer || viewer.role === "candidate")
    return { ok: false, error: "Referrals start when you register." };
  const index = currentReferralIndex(viewer);
  if (!index.contact(target)) return { ok: false, error: "That person isn't on your team." };
  if (referrer) {
    const err = referralError(index, target, referrer);
    if (err) return { ok: false, error: err };
  }
  const rows = index.rows(target).map((ref) => ({ ref, links: linksOf(ref) }));
  const writes = referralWrites(rows, referrer);
  const before = writes.map((w) => ({ ref: w.ref, links: linksOf(w.ref) }));
  for (const w of writes) writeLinks(w.ref, w.links);
  return {
    ok: true,
    undo: () => {
      for (const b of before) writeLinks(b.ref, b.links);
    },
  };
}
