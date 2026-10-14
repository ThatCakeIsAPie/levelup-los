import { useRef } from "react";
import { toast } from "sonner";
import { autoMap, parseFile } from "@/lib/parseSpreadsheet";
import { useTreeStore } from "@/components/mindmap/useTreeStore";
import { getViewer } from "@/data";

/**
 * Spreadsheet import for the mindmap. Returns a hidden file input plus an
 * `open()` you can call from any control (a button or a menu item).
 */
export function useSpreadsheetUpload() {
  const inputRef = useRef<HTMLInputElement>(null);
  const loadRows = useTreeStore((s) => s.loadRows);

  const handle = async (file: File) => {
    try {
      const rows = await parseFile(file);
      if (!rows.length) {
        toast.error("That file has no rows", {
          description: "Check that the first sheet has a header row and at least one person.",
        });
        return;
      }
      const map = autoMap(Object.keys(rows[0]));
      if (!map.id || !map.sponsorId) {
        toast.error("Couldn't find the ID and sponsor columns", {
          description: "Use headers like ID and SponsorID in the first row.",
        });
        return;
      }
      loadRows(rows, map, { source: "upload", key: getViewer()?.personId ?? "" });
      toast.success(`Loaded ${rows.length} ${rows.length === 1 ? "person" : "people"}`, {
        description:
          "PPV comes from the file (blank counts as 0). GPV, member counts and IDs are recalculated from the tree.",
        duration: 8000,
      });
    } catch (err) {
      console.error(err);
      toast.error("Couldn't read that file", {
        description: "Upload a .csv, .xlsx or .xls file.",
      });
    }
  };

  const input = (
    <input
      ref={inputRef}
      type="file"
      accept=".csv,.xlsx,.xls"
      className="hidden"
      tabIndex={-1}
      aria-hidden="true"
      onChange={(e) => {
        const f = e.target.files?.[0];
        if (f) void handle(f);
        e.target.value = "";
      }}
    />
  );

  return { input, open: () => inputRef.current?.click() };
}
