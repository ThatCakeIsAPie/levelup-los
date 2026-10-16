import { useState, type ReactNode } from "react";
import { toast } from "sonner";
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
import { PhoneInput } from "@/components/brand";
import { Label } from "@/components/ui/label";
import { addPerson, localDate } from "@/data";

/** Add a customer owned by the current user. */
export function AddCustomerDialog({
  open,
  onOpenChange,
  ownerId,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  ownerId: string;
}) {
  const [name, setName] = useState("");
  const [phone, setPhone] = useState("");
  const [email, setEmail] = useState("");
  const [volume, setVolume] = useState("");
  const [acquired, setAcquired] = useState(localDate());

  const reset = () => {
    setName("");
    setPhone("");
    setEmail("");
    setVolume("");
    setAcquired(localDate());
  };

  const volumeNum = volume.trim() === "" ? undefined : Number(volume);
  const volumeBad = volumeNum !== undefined && (!Number.isFinite(volumeNum) || volumeNum < 0);
  const valid = name.trim() !== "" && !volumeBad;

  const save = () => {
    if (!valid) return;
    addPerson({
      name: name.trim(),
      bizClass: "customer",
      ownerId,
      joinedDate: acquired || localDate(),
      ...(phone.trim() ? { phone: phone.trim() } : {}),
      ...(email.trim() ? { email: email.trim() } : {}),
      ...(volumeNum !== undefined ? { monthlyVolume: volumeNum } : {}),
    });
    toast.success(`${name.trim()} added to your customers`);
    reset();
    onOpenChange(false);
  };

  return (
    <Dialog
      open={open}
      onOpenChange={(o) => {
        if (!o) reset();
        onOpenChange(o);
      }}
    >
      <DialogContent className="sm:max-w-md">
        <DialogHeader>
          <DialogTitle>Add customer</DialogTitle>
          <DialogDescription>Customers are private to you.</DialogDescription>
        </DialogHeader>
        <form
          className="grid gap-4"
          onSubmit={(e) => {
            e.preventDefault();
            save();
          }}
        >
          <Field label="Name" htmlFor="cust-name">
            <Input
              id="cust-name"
              value={name}
              onChange={(e) => setName(e.target.value)}
              autoComplete="off"
              required
            />
          </Field>
          <div className="grid gap-4 sm:grid-cols-2">
            <Field label="Phone" htmlFor="cust-phone" optional>
              <PhoneInput
                id="cust-phone"
                value={phone}
                onValueChange={setPhone}
                autoComplete="off"
              />
            </Field>
            <Field label="Email" htmlFor="cust-email" optional>
              <Input
                id="cust-email"
                type="email"
                value={email}
                onChange={(e) => setEmail(e.target.value)}
                autoComplete="off"
              />
            </Field>
          </div>
          <div className="grid gap-4 sm:grid-cols-2">
            <Field label="Monthly volume ($)" htmlFor="cust-volume" optional>
              <Input
                id="cust-volume"
                type="number"
                inputMode="decimal"
                min={0}
                value={volume}
                onChange={(e) => setVolume(e.target.value)}
                aria-invalid={volumeBad || undefined}
              />
            </Field>
            <Field label="Date acquired" htmlFor="cust-acquired">
              <Input
                id="cust-acquired"
                type="date"
                value={acquired}
                max={localDate()}
                onChange={(e) => setAcquired(e.target.value)}
              />
            </Field>
          </div>
          <DialogFooter>
            <Button type="button" variant="outline" onClick={() => onOpenChange(false)}>
              Cancel
            </Button>
            <Button type="submit" disabled={!valid}>
              Add customer
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}

function Field({
  label,
  htmlFor,
  optional,
  children,
}: {
  label: string;
  htmlFor: string;
  optional?: boolean;
  children: ReactNode;
}) {
  return (
    <div className="grid gap-1.5">
      <Label htmlFor={htmlFor} className="text-[12.5px] font-semibold">
        {label}
        {optional && <span className="font-normal text-faint"> (optional)</span>}
      </Label>
      {children}
    </div>
  );
}
