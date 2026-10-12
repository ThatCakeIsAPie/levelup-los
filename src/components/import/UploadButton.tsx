import { useRef } from "react";
import { Upload } from "lucide-react";
import { autoMap, parseFile } from "@/lib/parseSpreadsheet";
import { useTreeStore } from "@/components/mindmap/useTreeStore";
import { toast } from "sonner";

export function UploadButton({ label = "Upload spreadsheet" }: { label?: string }) {
  const inputRef = useRef<HTMLInputElement>(null);
  const loadRows = useTreeStore((s) => s.loadRows);

  const handle = async (file: File) => {
    try {
      const rows = await parseFile(file);
      if (!rows.length) {
        toast.error("No rows found in the file");
        return;
      }
      const headers = Object.keys(rows[0]);
      const map = autoMap(headers);
      if (!map.id || !map.sponsorId) {
        toast.error("Could not detect ID / SponsorID columns. Expected headers like 'ID' and 'SponsorID'.");
        return;
      }
      loadRows(rows, map);
      toast.success(`Loaded ${rows.length} rows`);
    } catch (err) {
      console.error(err);
      toast.error("Failed to parse file");
    }
  };

  return (
    <>
      <input
        ref={inputRef}
        type="file"
        accept=".csv,.xlsx,.xls"
        className="hidden"
        onChange={(e) => {
          const f = e.target.files?.[0];
          if (f) handle(f);
          e.target.value = "";
        }}
      />
      <button
        type="button"
        onClick={() => inputRef.current?.click()}
        className="inline-flex items-center gap-1.5 rounded-md border border-input bg-background px-3 py-1.5 text-sm font-medium hover:bg-accent"
      >
        <Upload className="h-3.5 w-3.5" />
        {label}
      </button>
    </>
  );
}
