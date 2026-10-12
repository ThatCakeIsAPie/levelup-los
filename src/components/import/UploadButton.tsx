import { Upload } from "lucide-react";
import { Button } from "@/components/ui/button";
import { cn } from "@/lib/utils";
import { useSpreadsheetUpload } from "./useSpreadsheetUpload";

export function UploadButton({
  label = "Upload spreadsheet",
  className,
}: {
  label?: string;
  className?: string;
}) {
  const { input, open } = useSpreadsheetUpload();
  return (
    <>
      {input}
      <Button type="button" variant="outline" size="sm" className={cn(className)} onClick={open}>
        <Upload aria-hidden="true" />
        {label}
      </Button>
    </>
  );
}
