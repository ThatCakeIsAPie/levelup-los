import { toast } from "sonner";
import { bizClassLabel, localDate } from "@/data";
import { downloadCsv, toCsv } from "@/lib/csvExport";
import type { PersonRow } from "./model";

/** Download the given rows as a CSV (same columns as before the redesign, plus contact info). */
export function exportRowsCsv(rows: PersonRow[], label: string) {
  if (!rows.length) {
    toast("Nothing to export");
    return;
  }
  const data = rows.map((r) => {
    const p = r.person;
    const customer = p.bizClass === "customer";
    return {
      ID: p.id,
      Name: p.name,
      BizClass: bizClassLabel[r.stage],
      "IBO#": p.iboNumber ?? "",
      "LTD#": p.ltdNumber ?? "",
      Location: p.location ?? "",
      Email: p.email ?? "",
      Phone: p.phone ?? "",
      Sponsor: customer ? "" : (r.upline?.name ?? ""),
      Owner: customer ? (r.upline?.name ?? "") : "",
      MonthlyVolume: customer ? (p.monthlyVolume ?? "") : "",
      JoinedDate: p.joinedDate ?? "",
      BusinessStartDate: p.businessStartDate ?? "",
      PipelineStage: p.pipelineStage ?? "",
      ShowRate: r.showRate.eligible ? `${r.showRate.pct}%` : "",
      LastContact: r.contact.date ?? "",
      NextFollowUp: r.followUp ?? "",
      MissingFields: r.missing.join("; "),
      Tags: (p.tags ?? []).join("; "),
    };
  });
  downloadCsv(`${label}-${localDate()}.csv`, toCsv(data));
  toast.success(`Exported ${data.length} ${data.length === 1 ? "row" : "rows"}`);
}
