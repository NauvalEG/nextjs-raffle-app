"use client";

import * as React from "react";
import { useRouter } from "next/navigation";
import { toast } from "sonner";

import { importEntrants } from "@/actions/entrants";
import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { Textarea } from "@/components/ui/textarea";
import {
  MAX_FILE_BYTES,
  MAX_IMPORT_ROWS,
  autoDetectColumns,
  parseCsvText,
  validateRows,
  type ColumnMapping,
  type CsvRow,
  type RowPartition,
} from "@/lib/csv-import";
import { cn } from "@/lib/utils";

// Bulk import dialog (E1-02): input (paste | upload) → column mapping →
// preview → commit. Both input paths converge on the identical mapping and
// preview pipeline (FSD Bulk Import Rule 1). Nothing is persisted until the
// administrator confirms from the preview (Rule 2); the Server Action
// re-validates everything regardless (preview is a courtesy).

type Step = "input" | "mapping" | "preview";

const TOAST_EMPTY = "No entrant rows found in the input.";
const TOAST_UNREADABLE = "This file could not be read as CSV.";
const CONTACT_NOT_MAPPED = "__not_mapped__";

function formatLineNumbers(lines: number[]): string {
  return lines.join(", ");
}

export function ImportEntrantsDialog({
  raffleId,
  open,
  onOpenChange,
  existingTickets,
}: {
  raffleId: string;
  open: boolean;
  onOpenChange: (open: boolean) => void;
  /** Ticket/IDs of the raffle's current entrants (preview courtesy check). */
  existingTickets: string[];
}) {
  const router = useRouter();
  const fileInputRef = React.useRef<HTMLInputElement>(null);

  const [step, setStep] = React.useState<Step>("input");
  const [pasteText, setPasteText] = React.useState("");
  const [headers, setHeaders] = React.useState<string[]>([]);
  const [rows, setRows] = React.useState<CsvRow[]>([]);
  // Mapping selections are column indexes as strings ("" = unset).
  const [ticketCol, setTicketCol] = React.useState("");
  const [nameCol, setNameCol] = React.useState("");
  const [contactCol, setContactCol] = React.useState(CONTACT_NOT_MAPPED);
  const [partition, setPartition] = React.useState<RowPartition | null>(null);
  // Row-level rejections reported by the server on a failed commit (keyed by
  // source line number); merged into the re-rendered preview.
  const [serverErrors, setServerErrors] = React.useState<Map<number, string>>(new Map());
  const [previewPage, setPreviewPage] = React.useState(1);
  const [pending, setPending] = React.useState(false);

  const existingTicketSet = React.useMemo(() => new Set(existingTickets), [existingTickets]);

  const reset = () => {
    setStep("input");
    setPasteText("");
    setHeaders([]);
    setRows([]);
    setTicketCol("");
    setNameCol("");
    setContactCol(CONTACT_NOT_MAPPED);
    setPartition(null);
    setServerErrors(new Map());
    setPreviewPage(1);
    setPending(false);
    if (fileInputRef.current) fileInputRef.current.value = "";
  };

  const handleOpenChange = (next: boolean) => {
    if (!next) reset();
    onOpenChange(next);
  };

  // ---------------------------------------------------------------- input --

  const acceptParsed = (text: string, source: "paste" | "file") => {
    const parsed = parseCsvText(text);
    if (!parsed.ok) {
      toast.error(
        parsed.error === "empty"
          ? TOAST_EMPTY
          : source === "file"
            ? TOAST_UNREADABLE
            : TOAST_EMPTY
      );
      return;
    }
    if (parsed.rows.length > MAX_IMPORT_ROWS) {
      toast.error(
        `Too many rows. Imports are limited to ${MAX_IMPORT_ROWS.toLocaleString("en-US")} rows.`
      );
      return;
    }
    const detected = autoDetectColumns(parsed.headers);
    setHeaders(parsed.headers);
    setRows(parsed.rows);
    setTicketCol(detected.ticket === null ? "" : String(detected.ticket));
    setNameCol(detected.name === null ? "" : String(detected.name));
    setContactCol(detected.contact === null ? CONTACT_NOT_MAPPED : String(detected.contact));
    setPartition(null);
    setServerErrors(new Map());
    setStep("mapping");
  };

  const continueFromPaste = () => acceptParsed(pasteText, "paste");

  const handleFile = async (file: File) => {
    if (file.size > MAX_FILE_BYTES) {
      toast.error("This file is too large. The maximum file size is 5 MB.");
      return;
    }
    let text: string;
    try {
      text = await file.text(); // decoded as UTF-8 (FSD A4)
    } catch {
      toast.error(TOAST_UNREADABLE);
      return;
    }
    // Strip a UTF-8 BOM if present so the first header matches its alias.
    if (text.charCodeAt(0) === 0xfeff) text = text.slice(1);
    acceptParsed(text, "file");
  };

  // -------------------------------------------------------------- mapping --

  const tooFewColumns = headers.length < 2;
  const ticketIdx = ticketCol === "" ? null : Number(ticketCol);
  const nameIdx = nameCol === "" ? null : Number(nameCol);
  const contactIdx = contactCol === CONTACT_NOT_MAPPED ? null : Number(contactCol);

  const assigned = [ticketIdx, nameIdx, contactIdx].filter((i) => i !== null);
  const hasDuplicateAssignment = new Set(assigned).size !== assigned.length;

  const mappingValid =
    !tooFewColumns && ticketIdx !== null && nameIdx !== null && !hasDuplicateAssignment;

  const columnLabel = (i: number) => (headers[i] !== "" ? headers[i] : `Column ${i + 1}`);

  const continueToPreview = () => {
    if (!mappingValid || ticketIdx === null || nameIdx === null) return;
    const mapping: ColumnMapping = { ticket: ticketIdx, name: nameIdx, contact: contactIdx };
    const result = validateRows(rows, mapping, existingTicketSet);
    setPartition(result);
    setServerErrors(new Map());
    setPreviewPage(1);
    setStep("preview");
    if (result.rejected.length > 0) {
      const lines = result.rejected.map((r) => r.lineNumber).sort((a, b) => a - b);
      toast.warning(
        `Row${lines.length === 1 ? "" : "s"} ${formatLineNumbers(lines)} ${
          lines.length === 1 ? "is" : "are"
        } blocked and will not be imported.`
      );
    }
  };

  // -------------------------------------------------------------- preview --

  // Merge client partition with any server-reported row errors: a row the
  // server rejected is displayed as blocked even though the client passed it.
  const previewRows = React.useMemo(() => {
    if (!partition) return [];
    const merged = [
      ...partition.importable.map((r) => {
        const serverReason = serverErrors.get(r.lineNumber);
        return {
          lineNumber: r.lineNumber,
          ticket: r.ticketNumber,
          name: r.fullName,
          contact: r.contact ?? "",
          reason: serverReason ?? null,
        };
      }),
      ...partition.rejected.map((r) => ({
        lineNumber: r.lineNumber,
        ticket: r.ticket,
        name: r.name,
        contact: r.contact,
        reason: r.reason,
      })),
    ];
    merged.sort((a, b) => a.lineNumber - b.lineNumber);
    return merged;
  }, [partition, serverErrors]);

  const submittable = React.useMemo(
    () =>
      partition
        ? partition.importable.filter((r) => !serverErrors.has(r.lineNumber))
        : [],
    [partition, serverErrors]
  );
  const blockedCount = previewRows.length - submittable.length;

  const PREVIEW_PAGE_SIZE = 100;
  const previewTotalPages = Math.max(1, Math.ceil(previewRows.length / PREVIEW_PAGE_SIZE));
  const previewCurrentPage = Math.min(previewPage, previewTotalPages);
  const previewPageRows = previewRows.slice(
    (previewCurrentPage - 1) * PREVIEW_PAGE_SIZE,
    previewCurrentPage * PREVIEW_PAGE_SIZE
  );

  const commit = async () => {
    if (submittable.length === 0) return;
    setPending(true);
    try {
      const result = await importEntrants(raffleId, submittable);
      if (!result.ok) {
        toast.error(result.error);
        return;
      }
      if (result.data.rowErrors.length > 0) {
        // All-or-nothing: nothing was written. Re-render the preview with the
        // server's row-level rejections.
        const next = new Map(serverErrors);
        for (const err of result.data.rowErrors) next.set(err.lineNumber, err.reason);
        setServerErrors(next);
        const lines = result.data.rowErrors.map((e) => e.lineNumber).sort((a, b) => a - b);
        toast.error(
          `Import failed — no entrants were added. Row${lines.length === 1 ? "" : "s"} ${formatLineNumbers(lines)} ${lines.length === 1 ? "was" : "were"} rejected.`
        );
        return;
      }
      toast.success(
        `Imported ${result.data.imported} entrant${result.data.imported === 1 ? "" : "s"}.`
      );
      handleOpenChange(false);
      router.refresh();
    } finally {
      setPending(false);
    }
  };

  // --------------------------------------------------------------- render --

  return (
    <Dialog open={open} onOpenChange={handleOpenChange}>
      <DialogContent className="sm:max-w-2xl">
        <DialogHeader>
          <DialogTitle>Import entrants</DialogTitle>
          <DialogDescription>
            {step === "input" &&
              "Paste CSV text or upload a .csv file. The first line must be a header row."}
            {step === "mapping" &&
              "Confirm which column holds each field. Auto-detected matches are pre-selected."}
            {step === "preview" &&
              "Review the rows below. Blocked rows are highlighted and will not be imported."}
          </DialogDescription>
        </DialogHeader>

        {step === "input" && (
          <div className="space-y-4">
            <Tabs defaultValue="paste">
              <TabsList className="grid w-full grid-cols-2">
                <TabsTrigger value="paste">Paste</TabsTrigger>
                <TabsTrigger value="upload">Upload</TabsTrigger>
              </TabsList>
              <TabsContent value="paste" className="space-y-3 pt-2">
                <Textarea
                  value={pasteText}
                  onChange={(e) => setPasteText(e.target.value)}
                  placeholder={"ticket,name,contact\nA-1024,Ana Souza,ana@example.com"}
                  className="min-h-40 font-mono text-sm"
                />
                <div className="flex justify-end">
                  <Button onClick={continueFromPaste}>Continue</Button>
                </div>
              </TabsContent>
              <TabsContent value="upload" className="space-y-3 pt-2">
                <div className="space-y-2">
                  <Label htmlFor="import-csv-file">CSV file (max 5 MB)</Label>
                  <Input
                    id="import-csv-file"
                    ref={fileInputRef}
                    type="file"
                    accept=".csv,text/csv"
                    onChange={(e) => {
                      const file = e.target.files?.[0];
                      if (file) void handleFile(file);
                    }}
                  />
                </div>
                <p className="text-sm text-muted-foreground">
                  The file is parsed in your browser and on the server during import — it is
                  never stored.
                </p>
              </TabsContent>
            </Tabs>
          </div>
        )}

        {step === "mapping" && (
          <div className="space-y-4">
            {tooFewColumns ? (
              <p role="alert" className="text-sm text-destructive">
                At least two columns (ticket/ID and full name) are required.
              </p>
            ) : (
              <div className="grid gap-4 sm:grid-cols-3">
                <div className="space-y-2">
                  <Label>Ticket/ID</Label>
                  <Select value={ticketCol} onValueChange={setTicketCol}>
                    <SelectTrigger className="w-full">
                      <SelectValue placeholder="Select column" />
                    </SelectTrigger>
                    <SelectContent>
                      {headers.map((_, i) => (
                        <SelectItem key={i} value={String(i)}>
                          {columnLabel(i)}
                        </SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                  {ticketIdx === null && (
                    <p className="text-sm text-destructive">
                      Select which column contains the ticket/ID.
                    </p>
                  )}
                </div>
                <div className="space-y-2">
                  <Label>Full Name</Label>
                  <Select value={nameCol} onValueChange={setNameCol}>
                    <SelectTrigger className="w-full">
                      <SelectValue placeholder="Select column" />
                    </SelectTrigger>
                    <SelectContent>
                      {headers.map((_, i) => (
                        <SelectItem key={i} value={String(i)}>
                          {columnLabel(i)}
                        </SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                  {nameIdx === null && (
                    <p className="text-sm text-destructive">
                      Select which column contains the full name.
                    </p>
                  )}
                </div>
                <div className="space-y-2">
                  <Label>Contact (optional)</Label>
                  <Select value={contactCol} onValueChange={setContactCol}>
                    <SelectTrigger className="w-full">
                      <SelectValue placeholder="Not mapped" />
                    </SelectTrigger>
                    <SelectContent>
                      <SelectItem value={CONTACT_NOT_MAPPED}>Not mapped</SelectItem>
                      {headers.map((_, i) => (
                        <SelectItem key={i} value={String(i)}>
                          {columnLabel(i)}
                        </SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                </div>
              </div>
            )}
            {hasDuplicateAssignment && (
              <p role="alert" className="text-sm text-destructive">
                Each column can be mapped to only one field.
              </p>
            )}
            <DialogFooter>
              <Button variant="outline" onClick={() => setStep("input")}>
                Back
              </Button>
              <Button onClick={continueToPreview} disabled={!mappingValid}>
                Continue to preview
              </Button>
            </DialogFooter>
          </div>
        )}

        {step === "preview" && partition && (
          <div className="space-y-4">
            <p className="text-sm font-medium">
              {submittable.length} row{submittable.length === 1 ? "" : "s"} ready to import,{" "}
              {blockedCount} row{blockedCount === 1 ? "" : "s"} blocked.
            </p>
            <div className="max-h-80 overflow-y-auto rounded-md border">
              <Table>
                <TableHeader>
                  <TableRow>
                    <TableHead className="w-16">Line</TableHead>
                    <TableHead className="w-24">Ticket/ID</TableHead>
                    <TableHead>Full name</TableHead>
                    {contactIdx !== null && <TableHead>Contact</TableHead>}
                    <TableHead>Status</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {previewPageRows.map((row) => (
                    <TableRow
                      key={row.lineNumber}
                      className={cn(
                        row.reason !== null &&
                          "bg-destructive/10 hover:bg-destructive/15 data-[state=selected]:bg-destructive/15"
                      )}
                    >
                      <TableCell className="font-mono text-muted-foreground">
                        {row.lineNumber}
                      </TableCell>
                      <TableCell className="font-mono">{row.ticket}</TableCell>
                      <TableCell>{row.name}</TableCell>
                      {contactIdx !== null && (
                        <TableCell className="text-muted-foreground">{row.contact}</TableCell>
                      )}
                      <TableCell>
                        {row.reason === null ? (
                          <span className="text-muted-foreground">Ready</span>
                        ) : (
                          <span className="font-medium text-destructive">{row.reason}</span>
                        )}
                      </TableCell>
                    </TableRow>
                  ))}
                </TableBody>
              </Table>
            </div>
            {previewTotalPages > 1 && (
              <div className="flex items-center justify-end gap-2 text-sm text-muted-foreground">
                <Button
                  size="sm"
                  variant="outline"
                  disabled={previewCurrentPage <= 1}
                  onClick={() => setPreviewPage(previewCurrentPage - 1)}
                >
                  Previous
                </Button>
                <span>
                  Page {previewCurrentPage} of {previewTotalPages}
                </span>
                <Button
                  size="sm"
                  variant="outline"
                  disabled={previewCurrentPage >= previewTotalPages}
                  onClick={() => setPreviewPage(previewCurrentPage + 1)}
                >
                  Next
                </Button>
              </div>
            )}
            <DialogFooter>
              <Button variant="outline" onClick={() => setStep("mapping")} disabled={pending}>
                Back
              </Button>
              <Button onClick={commit} disabled={submittable.length === 0 || pending}>
                {pending
                  ? "Importing…"
                  : `Import ${submittable.length} entrant${submittable.length === 1 ? "" : "s"}`}
              </Button>
            </DialogFooter>
          </div>
        )}
      </DialogContent>
    </Dialog>
  );
}
