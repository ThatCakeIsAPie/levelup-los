import { useState } from "react";
import { Minus, Plus, MoreHorizontal, Users, ShoppingBag } from "lucide-react";
import { NODE_H, NODE_W } from "./layout";
import type { PositionedNode } from "./types";
import { cn } from "@/lib/utils";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import {
  Dialog,
  DialogContent,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Button } from "@/components/ui/button";
import { usePeopleStore, topCustomers, customersOf } from "@/stores/peopleStore";
import { useVisibleCustomers } from "@/data";
import { useTreeStore, type NewMemberClass } from "./useTreeStore";
import { toast } from "sonner";
import { useNavigate } from "@tanstack/react-router";

interface Props {
  node: PositionedNode;
  selected: boolean;
  onToggle: (id: string) => void;
  onSelect: (id: string) => void;
}

function fmt(n: number | undefined) {
  if (n === undefined || n === null) return "0.00";
  return n.toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 });
}

function bonusPct(gpv: number | undefined): number {
  const g = gpv ?? 0;
  if (g >= 7500) return 25;
  if (g >= 6000) return 23;
  if (g >= 4000) return 21;
  if (g >= 2500) return 18;
  if (g >= 1500) return 15;
  if (g >= 1000) return 12;
  if (g >= 600) return 9;
  if (g >= 300) return 6;
  if (g >= 100) return 3;
  return 0;
}

function initials(name: string) {
  return name
    .split(/[\s,]+/)
    .filter(Boolean)
    .slice(0, 2)
    .map((s) => s[0]?.toUpperCase() ?? "")
    .join("");
}

export function NodeCard({ node, selected, onToggle, onSelect }: Props) {
  const p = node.person;
  const rankLabel = `${bonusPct(p.gpv)}%`;

  const rosterPeople = usePeopleStore((s) => s.people);
  const myCustomers = useVisibleCustomers();
  const navigate = useNavigate();
  const openPerson = (edit: boolean) => {
    const rp =
      rosterPeople.find((r) => r.losUid === p.uid) ?? rosterPeople.find((r) => r.name === p.name);
    if (!rp) {
      toast.error("This person isn't in the roster yet.");
      return;
    }
    navigate({ to: "/people/$id", params: { id: rp.id }, hash: edit ? "edit" : undefined });
  };
  const addRosterPerson = usePeopleStore((s) => s.add);
  const addMember = useTreeStore((s) => s.addMember);
  const showCustomers = useTreeStore((s) => s.showCustomers);
  const showAllCustomers = useTreeStore((s) => s.showAllCustomers);
  const toggleCustomers = useTreeStore((s) => s.toggleCustomers);
  const customerPanelId = useTreeStore((s) => s.customerPanelId);
  const openCustomerPanel = useTreeStore((s) => s.openCustomerPanel);

  const roster = rosterPeople.find((rp) => rp.losUid === p.uid);
  // Only customers the viewer owns are visible (see src/data/access.ts).
  const allCustomers = roster ? customersOf(myCustomers, roster.id) : [];
  const top3 = roster ? topCustomers(myCustomers, roster.id, 3) : [];
  const customersVisible = showAllCustomers || showCustomers.has(p.id);
  const panelOpen = customerPanelId === p.id;

  const [memberDialog, setMemberDialog] = useState<NewMemberClass | null>(null);
  const [customerDialog, setCustomerDialog] = useState(false);

  return (
    <>
      <div
        role="button"
        tabIndex={0}
        onClick={() => onSelect(p.id)}
        onKeyDown={(e) => {
          if (e.key === "Enter") onSelect(p.id);
        }}
        className={cn(
          "absolute rounded-md border bg-card text-card-foreground shadow-sm transition-shadow",
          "hover:shadow-md cursor-pointer",
          selected ? "ring-2 ring-primary border-primary" : "border-border",
        )}
        style={{ left: node.x, top: node.y, width: NODE_W, height: NODE_H }}
      >
        <div className="flex h-full flex-col px-3 py-2 text-xs">
          <div className="flex items-start justify-between gap-1">
            <div className="min-w-0 flex-1">
              <div className="truncate text-sm font-medium text-foreground">{p.name}</div>
              <div className="text-muted-foreground">{rankLabel}</div>
            </div>
            <DropdownMenu>
              <DropdownMenuTrigger asChild>
                <button
                  type="button"
                  onClick={(e) => e.stopPropagation()}
                  className="-mr-1 -mt-1 rounded p-1 text-muted-foreground hover:bg-muted"
                  aria-label="More"
                >
                  <MoreHorizontal className="h-3.5 w-3.5" />
                </button>
              </DropdownMenuTrigger>
              <DropdownMenuContent align="end" className="w-44">
                <DropdownMenuItem onClick={() => openPerson(false)}>View person</DropdownMenuItem>
                <DropdownMenuItem onClick={() => openPerson(true)}>Edit person</DropdownMenuItem>
                <DropdownMenuSeparator />
                <DropdownMenuLabel className="text-xs">Add under {p.name}</DropdownMenuLabel>
                <DropdownMenuItem onClick={() => setMemberDialog("apprentice")}>
                  Add Apprentice
                </DropdownMenuItem>
                <DropdownMenuItem onClick={() => setMemberDialog("ibo")}>Add IBO</DropdownMenuItem>
                <DropdownMenuSeparator />
                <DropdownMenuItem onClick={() => setCustomerDialog(true)}>
                  Add Customer
                </DropdownMenuItem>
                {allCustomers.length > 0 && (
                  <DropdownMenuItem onClick={() => toggleCustomers(p.id)}>
                    {customersVisible ? "Hide customers" : "Show customers"}
                  </DropdownMenuItem>
                )}
              </DropdownMenuContent>
            </DropdownMenu>
          </div>
          <div className="mt-1 space-y-0.5">
            <div className="flex justify-between">
              <span className="text-muted-foreground">PPV</span>
              <span className="tabular-nums">{fmt(p.ppv)}</span>
            </div>
            <div className="flex justify-between">
              <span className="text-muted-foreground">GPV</span>
              <span className="tabular-nums">{fmt(p.gpv)}</span>
            </div>
          </div>
          <div className="mt-auto flex items-center gap-1 text-muted-foreground">
            <Users className="h-3 w-3" />
            <span className="tabular-nums">{p.memberCount ?? 1}</span>
            {customersVisible && allCustomers.length > 0 && (
              <div className="ml-auto flex items-center gap-1">
                <div className="flex -space-x-1.5">
                  {top3.map((c) => (
                    <span
                      key={c.id}
                      title={`${c.name} · ${c.monthlyVolume ?? 0} PV/mo`}
                      className="flex h-4 w-4 items-center justify-center rounded-full border border-background bg-primary/15 text-[8px] font-medium text-primary"
                    >
                      {initials(c.name)}
                    </span>
                  ))}
                </div>
                {allCustomers.length > 3 && (
                  <button
                    type="button"
                    onClick={(e) => {
                      e.stopPropagation();
                      openCustomerPanel(panelOpen ? null : p.id);
                    }}
                    className="text-[10px] underline hover:text-foreground"
                  >
                    +{allCustomers.length - 3} more
                  </button>
                )}
              </div>
            )}
          </div>
        </div>
        {node.hasChildren && (
          <button
            type="button"
            aria-label={node.expanded ? "Collapse" : "Expand"}
            onClick={(e) => {
              e.stopPropagation();
              onToggle(p.id);
            }}
            className={cn(
              "absolute left-1/2 -translate-x-1/2 -bottom-3 z-10",
              "flex h-6 w-6 items-center justify-center rounded-full border border-border bg-background text-muted-foreground shadow-sm",
              "hover:text-foreground hover:bg-muted",
            )}
          >
            {node.expanded ? <Minus className="h-3 w-3" /> : <Plus className="h-3 w-3" />}
          </button>
        )}
      </div>

      {panelOpen && (
        <div
          className="absolute z-20 w-56 rounded-md border border-border bg-popover p-2 text-xs shadow-lg"
          style={{ left: node.x + NODE_W + 12, top: node.y }}
          onClick={(e) => e.stopPropagation()}
        >
          <div className="mb-1.5 flex items-center gap-1 font-medium">
            <ShoppingBag className="h-3 w-3" /> Customers of {p.name}
            <button
              type="button"
              className="ml-auto text-muted-foreground hover:text-foreground"
              onClick={() => openCustomerPanel(null)}
              aria-label="Close"
            >
              ×
            </button>
          </div>
          <ul className="max-h-56 space-y-1 overflow-auto">
            {allCustomers.map((c) => (
              <li key={c.id} className="flex items-center justify-between gap-2">
                <span className="truncate">{c.name}</span>
                <span className="tabular-nums text-muted-foreground">{c.monthlyVolume ?? 0}</span>
              </li>
            ))}
          </ul>
        </div>
      )}

      <AddMemberDialog
        bizClass={memberDialog}
        parentName={p.name}
        onClose={() => setMemberDialog(null)}
        onSubmit={(input) => {
          addMember(p.id, input);
          toast.success(`${input.name} added under ${p.name}`);
          setMemberDialog(null);
        }}
      />

      <AddCustomerDialog
        open={customerDialog}
        ownerName={p.name}
        onClose={() => setCustomerDialog(false)}
        onSubmit={(data) => {
          if (!roster) {
            toast.error("This member isn't on the roster yet.");
            return;
          }
          addRosterPerson({
            name: data.name,
            bizClass: "customer",
            ownerId: roster.id,
            email: data.email || undefined,
            phone: data.phone || undefined,
            monthlyVolume: data.monthlyVolume ? Number(data.monthlyVolume) : undefined,
            joinedDate: data.startDate || undefined,
            sponsorId: roster.id,
          });
          toast.success(`${data.name} added as a customer of ${p.name}`);
          setCustomerDialog(false);
          useTreeStore.getState().toggleCustomers(p.id);
        }}
      />
    </>
  );
}

function AddMemberDialog({
  bizClass,
  parentName,
  onClose,
  onSubmit,
}: {
  bizClass: NewMemberClass | null;
  parentName: string;
  onClose: () => void;
  onSubmit: (input: {
    name: string;
    bizClass: NewMemberClass;
    businessStartDate?: string;
    iboNumber?: string;
    ltdNumber?: string;
    location?: string;
  }) => void;
}) {
  const [name, setName] = useState("");
  const [startDate, setStartDate] = useState("");
  const [iboNumber, setIboNumber] = useState("");
  const [ltdNumber, setLtdNumber] = useState("");
  const [location, setLocation] = useState("");
  const [error, setError] = useState<string | null>(null);

  const reset = () => {
    setName("");
    setStartDate("");
    setIboNumber("");
    setLtdNumber("");
    setLocation("");
    setError(null);
  };

  return (
    <Dialog
      open={bizClass !== null}
      onOpenChange={(o) => {
        if (!o) {
          reset();
          onClose();
        }
      }}
    >
      <DialogContent>
        <DialogHeader>
          <DialogTitle>
            Add {bizClass === "apprentice" ? "Apprentice" : "IBO"} under {parentName}
          </DialogTitle>
        </DialogHeader>
        <div className="grid gap-3">
          <div className="grid gap-1.5">
            <Label>Name *</Label>
            <Input value={name} onChange={(e) => setName(e.target.value)} />
          </div>
          <div className="grid gap-1.5">
            <Label>Business start date {bizClass === "apprentice" ? "*" : ""}</Label>
            <Input type="date" value={startDate} onChange={(e) => setStartDate(e.target.value)} />
            {bizClass === "apprentice" && (
              <p className="text-[11px] text-muted-foreground">
                Becomes an IBO automatically one year after this date.
              </p>
            )}
          </div>
          <div className="grid grid-cols-2 gap-3">
            <div className="grid gap-1.5">
              <Label>IBO#</Label>
              <Input value={iboNumber} onChange={(e) => setIboNumber(e.target.value)} />
            </div>
            <div className="grid gap-1.5">
              <Label>LTD#</Label>
              <Input value={ltdNumber} onChange={(e) => setLtdNumber(e.target.value)} />
            </div>
          </div>
          <div className="grid gap-1.5">
            <Label>Location</Label>
            <Input
              value={location}
              onChange={(e) => setLocation(e.target.value)}
              placeholder="City, State"
            />
          </div>
          {error && <p className="text-xs text-destructive">{error}</p>}
        </div>
        <DialogFooter>
          <Button
            variant="ghost"
            onClick={() => {
              reset();
              onClose();
            }}
          >
            Cancel
          </Button>
          <Button
            onClick={() => {
              if (!name.trim()) {
                setError("Name is required.");
                return;
              }
              if (bizClass === "apprentice" && !startDate) {
                setError("Business start date is required for an apprentice.");
                return;
              }
              onSubmit({
                name: name.trim(),
                bizClass: bizClass ?? "ibo",
                businessStartDate: startDate || undefined,
                iboNumber: iboNumber.trim() || undefined,
                ltdNumber: ltdNumber.trim() || undefined,
                location: location.trim() || undefined,
              });
              reset();
            }}
          >
            Add
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

function AddCustomerDialog({
  open,
  ownerName,
  onClose,
  onSubmit,
}: {
  open: boolean;
  ownerName: string;
  onClose: () => void;
  onSubmit: (data: {
    name: string;
    email: string;
    phone: string;
    monthlyVolume: string;
    startDate: string;
  }) => void;
}) {
  const [form, setForm] = useState({
    name: "",
    email: "",
    phone: "",
    monthlyVolume: "",
    startDate: "",
  });
  const [error, setError] = useState<string | null>(null);
  const reset = () => {
    setForm({ name: "", email: "", phone: "", monthlyVolume: "", startDate: "" });
    setError(null);
  };

  return (
    <Dialog
      open={open}
      onOpenChange={(o) => {
        if (!o) {
          reset();
          onClose();
        }
      }}
    >
      <DialogContent>
        <DialogHeader>
          <DialogTitle>Add customer of {ownerName}</DialogTitle>
        </DialogHeader>
        <div className="grid gap-3">
          <div className="grid gap-1.5">
            <Label>Name *</Label>
            <Input value={form.name} onChange={(e) => setForm({ ...form, name: e.target.value })} />
          </div>
          <div className="grid grid-cols-2 gap-3">
            <div className="grid gap-1.5">
              <Label>Email</Label>
              <Input
                type="email"
                value={form.email}
                onChange={(e) => setForm({ ...form, email: e.target.value })}
              />
            </div>
            <div className="grid gap-1.5">
              <Label>Phone</Label>
              <Input
                value={form.phone}
                onChange={(e) => setForm({ ...form, phone: e.target.value })}
              />
            </div>
          </div>
          <div className="grid grid-cols-2 gap-3">
            <div className="grid gap-1.5">
              <Label>Monthly volume</Label>
              <Input
                type="number"
                value={form.monthlyVolume}
                onChange={(e) => setForm({ ...form, monthlyVolume: e.target.value })}
              />
            </div>
            <div className="grid gap-1.5">
              <Label>Start date</Label>
              <Input
                type="date"
                value={form.startDate}
                onChange={(e) => setForm({ ...form, startDate: e.target.value })}
              />
            </div>
          </div>
          {error && <p className="text-xs text-destructive">{error}</p>}
        </div>
        <DialogFooter>
          <Button
            variant="ghost"
            onClick={() => {
              reset();
              onClose();
            }}
          >
            Cancel
          </Button>
          <Button
            onClick={() => {
              if (!form.name.trim()) {
                setError("Name is required.");
                return;
              }
              onSubmit({ ...form, name: form.name.trim() });
              reset();
            }}
          >
            Add
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
