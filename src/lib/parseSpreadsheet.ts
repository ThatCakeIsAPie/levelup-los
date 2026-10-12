import Papa from "papaparse";
import * as XLSX from "xlsx";

export type Row = Record<string, string | number | null | undefined>;

export async function parseFile(file: File): Promise<Row[]> {
  const name = file.name.toLowerCase();
  if (name.endsWith(".csv")) {
    const text = await file.text();
    const res = Papa.parse<Row>(text, { header: true, skipEmptyLines: true, dynamicTyping: true });
    return res.data as Row[];
  }
  const buf = await file.arrayBuffer();
  const wb = XLSX.read(buf, { type: "array" });
  const sheet = wb.Sheets[wb.SheetNames[0]];
  return XLSX.utils.sheet_to_json<Row>(sheet, { defval: null });
}

export interface FieldMap {
  id: string;
  name?: string;
  firstName?: string;
  lastName?: string;
  sponsorId: string;
  rank?: string;
  ppv?: string;
  gpv?: string;
  customers?: string;
}

const candidates = {
  id: ["id", "memberid", "member id", "userid", "user id", "associateid"],
  name: ["name", "fullname", "full name"],
  firstName: ["firstname", "first name", "first"],
  lastName: ["lastname", "last name", "last"],
  sponsorId: ["sponsorid", "sponsor id", "sponsor", "uplineid", "upline id", "parentid", "parent id", "enroller", "enrollerid"],
  rank: ["rank", "rankpercent", "rank %", "rank%", "percent", "%"],
  ppv: ["ppv", "personal volume", "pv"],
  gpv: ["gpv", "group volume", "gv"],
  customers: ["customers", "customer count", "#customers", "customer"],
};

export function autoMap(headers: string[]): FieldMap {
  const norm = (s: string) => s.toLowerCase().replace(/[\s_-]+/g, "");
  const lookup: Record<string, string> = {};
  for (const h of headers) lookup[norm(h)] = h;
  const pick = (keys: string[]) => {
    for (const k of keys) {
      const hit = lookup[norm(k)];
      if (hit) return hit;
    }
    return undefined;
  };
  return {
    id: pick(candidates.id) ?? headers[0] ?? "",
    name: pick(candidates.name),
    firstName: pick(candidates.firstName),
    lastName: pick(candidates.lastName),
    sponsorId: pick(candidates.sponsorId) ?? "",
    rank: pick(candidates.rank),
    ppv: pick(candidates.ppv),
    gpv: pick(candidates.gpv),
    customers: pick(candidates.customers),
  };
}
