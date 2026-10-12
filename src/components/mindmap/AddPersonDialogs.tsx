import { useId, useRef, useState, type ReactNode } from "react";
import { CalendarClock, Info } from "lucide-react";
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
import { Button } from "@/components/ui/button";
import { localDate } from "@/data";
import type { NewMemberClass, NewMemberInput } from "./useTreeStore";

function Field({
  label,
  required,
  hint,
  error,
  children,
  htmlFor,
}: {
  label: string;
  required?: boolean;
  hint?: ReactNode;
  error?: string | null;
  children: ReactNode;
  htmlFor: string;
}) {
  return (
    <div className="grid gap-1.5">
      <Label htmlFor={htmlFor} className="text-xs font-semibold">
        {label}
        {required ? (
          <span className="text-bad" aria-hidden="true">
            {" "}
            *
          </span>
        ) : (
          <span className="font-normal text-faint"> (optional)</span>
        )}
      </Label>
      {children}
      {error ? (
        <p id={`${htmlFor}-error`} className="text-xs font-medium text-bad">
          {error}
        </p>
      ) : hint ? (
        <p id={`${htmlFor}-hint`} className="text-xs text-muted-foreground">
          {hint}
        </p>
      ) : null}
    </div>
  );
}

const MEMBER_COPY: Record<NewMemberClass, { title: string; body: string }> = {
  apprentice: {
    title: "Add apprentice",
    body: "Apprentices are in their first contract year and become IBOs automatically one year after their business start date.",
  },
  ibo: {
    title: "Add IBO",
    body: "IBOs are independent business owners on the business path.",
  },
};

/** Add an apprentice or IBO under a card. Business start date is required for apprentices. */
export function AddMemberDialog({
  bizClass,
  parentName,
  onClose,
  onSubmit,
}: {
  bizClass: NewMemberClass | null;
  parentName: string;
  onClose: () => void;
  onSubmit: (input: NewMemberInput) => void;
}) {
  const uid = useId();
  const [name, setName] = useState("");
  const [startDate, setStartDate] = useState("");
  const [iboNumber, setIboNumber] = useState("");
  const [ltdNumber, setLtdNumber] = useState("");
  const [location, setLocation] = useState("");
  const [errors, setErrors] = useState<{ name?: string; startDate?: string }>({});

  const reset = () => {
    setName("");
    setStartDate("");
    setIboNumber("");
    setLtdNumber("");
    setLocation("");
    setErrors({});
  };
  const close = () => {
    reset();
    onClose();
  };

  // Keep the last labels while the dialog animates closed.
  const last = useRef({ bizClass: bizClass ?? "ibo", parentName });
  if (bizClass) last.current = { bizClass, parentName };
  const shown = last.current;
  const isApprentice = bizClass === "apprentice";
  const copy = MEMBER_COPY[shown.bizClass];

  const submit = () => {
    const next: typeof errors = {};
    if (!name.trim()) next.name = "Enter a name.";
    if (isApprentice && !startDate) next.startDate = "Apprentices need a business start date.";
    setErrors(next);
    if (next.name || next.startDate) return;
    onSubmit({
      name: name.trim(),
      bizClass: bizClass ?? "ibo",
      businessStartDate: startDate || undefined,
      iboNumber: iboNumber.trim() || undefined,
      ltdNumber: ltdNumber.trim() || undefined,
      location: location.trim() || undefined,
    });
    reset();
  };

  return (
    <Dialog open={bizClass !== null} onOpenChange={(o) => !o && close()}>
      <DialogContent className="max-h-[calc(100dvh-2rem)] overflow-y-auto sm:max-w-md">
        <DialogHeader>
          <DialogTitle className="text-[17px] font-extrabold">
            {copy.title} under {shown.parentName}
          </DialogTitle>
          <DialogDescription className="text-[13px]">{copy.body}</DialogDescription>
        </DialogHeader>
        <form
          noValidate
          className="grid gap-4"
          onSubmit={(e) => {
            e.preventDefault();
            submit();
          }}
        >
          <Field label="Name" required htmlFor={`${uid}-name`} error={errors.name}>
            <Input
              id={`${uid}-name`}
              value={name}
              autoComplete="off"
              aria-invalid={!!errors.name}
              aria-describedby={errors.name ? `${uid}-name-error` : undefined}
              onChange={(e) => setName(e.target.value)}
            />
          </Field>
          <Field
            label="Business start date"
            required={isApprentice}
            htmlFor={`${uid}-start`}
            error={errors.startDate}
            hint={
              isApprentice ? (
                <span className="inline-flex items-start gap-1">
                  <CalendarClock className="mt-0.5 size-3 shrink-0" aria-hidden="true" />
                  Becomes an IBO one year after this date.
                </span>
              ) : undefined
            }
          >
            <Input
              id={`${uid}-start`}
              type="date"
              value={startDate}
              max={localDate()}
              aria-invalid={!!errors.startDate}
              aria-describedby={
                errors.startDate
                  ? `${uid}-start-error`
                  : isApprentice
                    ? `${uid}-start-hint`
                    : undefined
              }
              onChange={(e) => setStartDate(e.target.value)}
            />
          </Field>
          <div className="grid grid-cols-2 gap-3">
            <Field label="IBO number" htmlFor={`${uid}-ibo`}>
              <Input
                id={`${uid}-ibo`}
                value={iboNumber}
                onChange={(e) => setIboNumber(e.target.value)}
              />
            </Field>
            <Field label="LTD number" htmlFor={`${uid}-ltd`}>
              <Input
                id={`${uid}-ltd`}
                value={ltdNumber}
                onChange={(e) => setLtdNumber(e.target.value)}
              />
            </Field>
          </div>
          <Field label="Location" htmlFor={`${uid}-loc`}>
            <Input
              id={`${uid}-loc`}
              value={location}
              placeholder="City, state"
              onChange={(e) => setLocation(e.target.value)}
            />
          </Field>
          <DialogFooter className="gap-2 sm:gap-0">
            <Button type="button" variant="outline" onClick={close}>
              Cancel
            </Button>
            <Button type="submit">{copy.title}</Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}

export interface NewCustomerInput {
  name: string;
  email: string;
  phone: string;
  monthlyVolume: string;
  startDate: string;
}

const EMPTY_CUSTOMER: NewCustomerInput = {
  name: "",
  email: "",
  phone: "",
  monthlyVolume: "",
  startDate: "",
};

/** Add a customer owned by a card's person. Customers don't join the downline. */
export function AddCustomerDialog({
  open,
  ownerName,
  isOwnCard,
  onClose,
  onSubmit,
}: {
  open: boolean;
  ownerName: string;
  /** True when the card is the viewer's own (they will see the new customer). */
  isOwnCard: boolean;
  onClose: () => void;
  onSubmit: (data: NewCustomerInput) => void;
}) {
  const uid = useId();
  const last = useRef({ ownerName, isOwnCard });
  if (open) last.current = { ownerName, isOwnCard };
  const shown = last.current;
  const [form, setForm] = useState(EMPTY_CUSTOMER);
  const [error, setError] = useState<string | null>(null);
  const set = (patch: Partial<NewCustomerInput>) => setForm((f) => ({ ...f, ...patch }));
  const close = () => {
    setForm(EMPTY_CUSTOMER);
    setError(null);
    onClose();
  };

  return (
    <Dialog open={open} onOpenChange={(o) => !o && close()}>
      <DialogContent className="max-h-[calc(100dvh-2rem)] overflow-y-auto sm:max-w-md">
        <DialogHeader>
          <DialogTitle className="text-[17px] font-extrabold">
            {shown.isOwnCard ? "Add a customer" : `Add a customer for ${shown.ownerName}`}
          </DialogTitle>
          <DialogDescription className="text-[13px]">
            Customers belong to {shown.isOwnCard ? "you" : shown.ownerName} and don't count toward
            GPV or member counts.
          </DialogDescription>
        </DialogHeader>
        <form
          noValidate
          className="grid gap-4"
          onSubmit={(e) => {
            e.preventDefault();
            if (!form.name.trim()) {
              setError("Enter a name.");
              return;
            }
            onSubmit({ ...form, name: form.name.trim() });
            setForm(EMPTY_CUSTOMER);
            setError(null);
          }}
        >
          <Field label="Name" required htmlFor={`${uid}-name`} error={error}>
            <Input
              id={`${uid}-name`}
              value={form.name}
              autoComplete="off"
              aria-invalid={!!error}
              aria-describedby={error ? `${uid}-name-error` : undefined}
              onChange={(e) => set({ name: e.target.value })}
            />
          </Field>
          <div className="grid gap-3 sm:grid-cols-2">
            <Field label="Email" htmlFor={`${uid}-email`}>
              <Input
                id={`${uid}-email`}
                type="email"
                value={form.email}
                onChange={(e) => set({ email: e.target.value })}
              />
            </Field>
            <Field label="Phone" htmlFor={`${uid}-phone`}>
              <Input
                id={`${uid}-phone`}
                type="tel"
                value={form.phone}
                onChange={(e) => set({ phone: e.target.value })}
              />
            </Field>
          </div>
          <div className="grid grid-cols-2 gap-3">
            <Field label="Monthly volume" htmlFor={`${uid}-vol`}>
              <Input
                id={`${uid}-vol`}
                type="number"
                inputMode="decimal"
                min={0}
                value={form.monthlyVolume}
                onChange={(e) => set({ monthlyVolume: e.target.value })}
              />
            </Field>
            <Field label="Start date" htmlFor={`${uid}-start`}>
              <Input
                id={`${uid}-start`}
                type="date"
                value={form.startDate}
                onChange={(e) => set({ startDate: e.target.value })}
              />
            </Field>
          </div>
          {!shown.isOwnCard && (
            <p className="flex items-start gap-2 rounded-lg bg-info-soft px-3 py-2 text-xs text-info-ink">
              <Info className="mt-0.5 size-3.5 shrink-0" aria-hidden="true" />
              Customer lists are private to their owner, so this customer won't show on your map.
            </p>
          )}
          <DialogFooter className="gap-2 sm:gap-0">
            <Button type="button" variant="outline" onClick={close}>
              Cancel
            </Button>
            <Button type="submit">Add customer</Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}
