import { useMemo } from "react";
import { useForm, useWatch } from "react-hook-form";
import { zodResolver } from "@hookform/resolvers/zod";
import { z } from "zod";
import { useNavigate } from "@tanstack/react-router";
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
import {
  Form,
  FormControl,
  FormDescription,
  FormField,
  FormItem,
  FormLabel,
  FormMessage,
} from "@/components/ui/form";
import { Input } from "@/components/ui/input";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { Textarea } from "@/components/ui/textarea";
import {
  addPerson,
  effectiveBizClass,
  localDate,
  useCurrentUser,
  useVisibleTeam,
  type CrmPerson,
} from "@/data";
import { cn } from "@/lib/utils";
import { STAGE_LABEL } from "@/components/brand";
import { anniversaryOf, fullDate } from "./model";

const schema = z
  .object({
    path: z.enum(["business", "customer"]),
    stage: z.enum(["prospect", "apprentice", "ibo"]),
    name: z.string().trim().min(1, "Enter a name"),
    email: z.union([z.literal(""), z.string().trim().email("Enter a valid email")]),
    phone: z.string().trim(),
    location: z.string().trim(),
    joinedDate: z.string(),
    sponsorId: z.string(),
    iboNumber: z.string().trim(),
    ltdNumber: z.string().trim(),
    businessStartDate: z.string(),
    ownerId: z.string(),
    monthlyVolume: z
      .string()
      .trim()
      .refine((v) => v === "" || (Number.isFinite(Number(v)) && Number(v) >= 0), {
        message: "Enter a number of 0 or more",
      }),
    notes: z.string(),
  })
  .superRefine((v, ctx) => {
    const need = (path: keyof typeof v, message: string) =>
      ctx.addIssue({ code: z.ZodIssueCode.custom, path: [path], message });
    if (v.path === "customer") {
      if (!v.ownerId) need("ownerId", "Choose who owns this customer");
      return;
    }
    if (!v.sponsorId) need("sponsorId", "Choose a sponsor");
    if (v.stage !== "prospect") {
      if (!v.iboNumber) need("iboNumber", "Required for apprentices and IBOs");
      if (!v.ltdNumber) need("ltdNumber", "Required for apprentices and IBOs");
    }
    if (v.stage === "apprentice" && !v.businessStartDate)
      need("businessStartDate", "Required for apprentices");
    if (v.businessStartDate && v.businessStartDate > localDate())
      need("businessStartDate", "Can't be in the future");
  });

type Values = z.infer<typeof schema>;

function blank(path: "business" | "customer", me: string): Values {
  return {
    path,
    stage: "prospect",
    name: "",
    email: "",
    phone: "",
    location: "",
    joinedDate: localDate(),
    sponsorId: me,
    iboNumber: "",
    ltdNumber: "",
    businessStartDate: "",
    ownerId: me,
    monthlyVolume: "",
    notes: "",
  };
}

const opt = (s: string) => (s ? s : undefined);

/**
 * Add a person on the business path (prospect / apprentice / IBO under a
 * sponsor) or the customer path (owned by an apprentice or IBO).
 */
export function AddPersonDialog({
  open,
  onOpenChange,
  defaultPath,
  formKey,
}: {
  open: boolean;
  onOpenChange: (o: boolean) => void;
  defaultPath: "business" | "customer";
  /** Change to reset the form (e.g. bump on every open). */
  formKey: number;
}) {
  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-h-[92dvh] w-[calc(100%-2rem)] gap-5 overflow-y-auto rounded-card sm:max-w-xl">
        <DialogHeader className="text-left">
          <DialogTitle className="text-lg font-extrabold">Add person</DialogTitle>
          <DialogDescription>
            Add someone to your business team or one of your customers.
          </DialogDescription>
        </DialogHeader>
        {/* A new key on every open starts the form clean with the right path. */}
        <AddPersonForm key={formKey} defaultPath={defaultPath} onDone={() => onOpenChange(false)} />
      </DialogContent>
    </Dialog>
  );
}

function AddPersonForm({
  defaultPath,
  onDone,
}: {
  defaultPath: "business" | "customer";
  onDone: () => void;
}) {
  const user = useCurrentUser();
  const team = useVisibleTeam();
  const navigate = useNavigate();
  const form = useForm<Values>({
    resolver: zodResolver(schema),
    defaultValues: blank(defaultPath, user.personId),
  });
  const path = useWatch({ control: form.control, name: "path" });
  const stage = useWatch({ control: form.control, name: "stage" });
  const startDate = useWatch({ control: form.control, name: "businessStartDate" });

  const sponsors = useMemo(() => [...team].sort((a, b) => a.name.localeCompare(b.name)), [team]);
  const owners = useMemo(
    () => sponsors.filter((p) => effectiveBizClass(p) !== "prospect"),
    [sponsors],
  );
  const nameOf = (id: string) =>
    id === user.personId ? `${user.name} (you)` : (team.find((p) => p.id === id)?.name ?? "");

  const onSubmit = (v: Values) => {
    const base = {
      name: v.name,
      email: opt(v.email),
      phone: opt(v.phone),
      location: opt(v.location),
      joinedDate: opt(v.joinedDate),
      notes: opt(v.notes),
    };
    const person: Omit<CrmPerson, "id"> =
      v.path === "customer"
        ? {
            ...base,
            bizClass: "customer",
            ownerId: v.ownerId,
            sponsorId: null,
            monthlyVolume: v.monthlyVolume === "" ? undefined : Number(v.monthlyVolume),
          }
        : {
            ...base,
            bizClass: v.stage,
            pipelineStage: v.stage,
            sponsorId: v.sponsorId,
            iboNumber: v.stage === "prospect" ? opt(v.iboNumber) : v.iboNumber,
            ltdNumber: v.stage === "prospect" ? opt(v.ltdNumber) : v.ltdNumber,
            businessStartDate: v.stage === "prospect" ? undefined : opt(v.businessStartDate),
          };
    const created = addPerson(person);
    const hidden = v.path === "customer" && v.ownerId !== user.personId;
    toast.success(`Added ${created.name}`, {
      description: hidden
        ? `Customers are private to their owner, so only ${nameOf(v.ownerId)} will see them.`
        : undefined,
      action: hidden
        ? undefined
        : {
            label: "Open",
            onClick: () => navigate({ to: "/people/$id", params: { id: created.id } }),
          },
    });
    onDone();
  };

  const anniversary =
    stage === "apprentice" && startDate
      ? anniversaryOf({ businessStartDate: startDate } as CrmPerson)
      : undefined;

  return (
    <Form {...form}>
      <form onSubmit={form.handleSubmit(onSubmit)} className="grid gap-4" noValidate>
        <FormField
          control={form.control}
          name="path"
          render={({ field }) => (
            <FormItem>
              <FormLabel>Relationship</FormLabel>
              <div
                role="radiogroup"
                aria-label="Relationship"
                className="grid grid-cols-2 gap-0.5 rounded-[10px] bg-surface-2 p-[3px]"
              >
                {(
                  [
                    ["business", "Business team"],
                    ["customer", "Customer"],
                  ] as const
                ).map(([value, label]) => (
                  <button
                    key={value}
                    type="button"
                    role="radio"
                    aria-checked={field.value === value}
                    onClick={() => field.onChange(value)}
                    className={cn(
                      "rounded-lg py-1.5 text-[12.5px] font-semibold text-muted-foreground focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-ring",
                      field.value === value &&
                        "bg-surface text-foreground shadow-[0_1px_2px_rgba(0,0,0,.08)]",
                    )}
                  >
                    {label}
                  </button>
                ))}
              </div>
            </FormItem>
          )}
        />

        <div className="grid gap-4 sm:grid-cols-2">
          <TextField
            form={form}
            name="name"
            label="Name"
            required
            autoFocus
            className="sm:col-span-2"
          />
          <TextField form={form} name="email" label="Email" type="email" />
          <TextField form={form} name="phone" label="Phone" type="tel" />
          <TextField form={form} name="location" label="Location" placeholder="City, State" />
          <TextField form={form} name="joinedDate" label="Joined" type="date" />
        </div>

        {path === "business" ? (
          <div className="grid gap-4 rounded-card border border-line bg-surface-2/50 p-4 sm:grid-cols-2">
            <FormField
              control={form.control}
              name="stage"
              render={({ field }) => (
                <FormItem>
                  <FormLabel>Stage</FormLabel>
                  <Select value={field.value} onValueChange={field.onChange}>
                    <FormControl>
                      <SelectTrigger>
                        <SelectValue />
                      </SelectTrigger>
                    </FormControl>
                    <SelectContent>
                      {(["prospect", "apprentice", "ibo"] as const).map((s) => (
                        <SelectItem key={s} value={s}>
                          {STAGE_LABEL[s]}
                        </SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                </FormItem>
              )}
            />
            <PersonSelect
              form={form}
              name="sponsorId"
              label="Sponsor"
              people={sponsors}
              nameOf={nameOf}
              placeholder="Choose a sponsor"
            />
            {stage !== "prospect" && (
              <>
                <TextField form={form} name="iboNumber" label="IBO#" required />
                <TextField form={form} name="ltdNumber" label="LTD#" required />
                <TextField
                  form={form}
                  name="businessStartDate"
                  label="Business start date"
                  type="date"
                  required={stage === "apprentice"}
                  max={localDate()}
                  description={
                    anniversary
                      ? anniversary <= localDate()
                        ? "Their first year is complete, so they'll show as an IBO."
                        : `Becomes an IBO automatically on ${fullDate(anniversary)}.`
                      : stage === "apprentice"
                        ? "Apprentices become IBOs one year after this date."
                        : undefined
                  }
                  className="sm:col-span-2"
                />
              </>
            )}
          </div>
        ) : (
          <div className="grid gap-4 rounded-card border border-line bg-surface-2/50 p-4 sm:grid-cols-2">
            <PersonSelect
              form={form}
              name="ownerId"
              label="Owner"
              people={owners}
              nameOf={nameOf}
              placeholder="Choose an apprentice or IBO"
              description="Only the owner sees this customer."
            />
            <TextField
              form={form}
              name="monthlyVolume"
              label="Monthly volume (PV)"
              type="number"
              inputMode="decimal"
              min={0}
            />
          </div>
        )}

        <FormField
          control={form.control}
          name="notes"
          render={({ field }) => (
            <FormItem>
              <FormLabel>Notes</FormLabel>
              <FormControl>
                <Textarea rows={3} {...field} />
              </FormControl>
            </FormItem>
          )}
        />

        <DialogFooter className="gap-2 sm:gap-0">
          <Button type="button" variant="ghost" onClick={onDone}>
            Cancel
          </Button>
          <Button type="submit">Add person</Button>
        </DialogFooter>
      </form>
    </Form>
  );
}

type FormApi = ReturnType<typeof useForm<Values>>;

function TextField({
  form,
  name,
  label,
  required,
  description,
  className,
  ...input
}: {
  form: FormApi;
  name: keyof Values;
  label: string;
  required?: boolean;
  description?: string;
  className?: string;
} & Omit<React.ComponentProps<typeof Input>, "form" | "name" | "required">) {
  return (
    <FormField
      control={form.control}
      name={name}
      render={({ field }) => (
        <FormItem className={className}>
          <FormLabel>
            {label}
            {required && (
              <span className="text-muted-foreground" aria-hidden="true">
                {" "}
                *
              </span>
            )}
          </FormLabel>
          <FormControl>
            <Input {...input} {...field} aria-required={required || undefined} />
          </FormControl>
          {description && <FormDescription>{description}</FormDescription>}
          <FormMessage />
        </FormItem>
      )}
    />
  );
}

function PersonSelect({
  form,
  name,
  label,
  people,
  nameOf,
  placeholder,
  description,
}: {
  form: FormApi;
  name: "sponsorId" | "ownerId";
  label: string;
  people: CrmPerson[];
  nameOf: (id: string) => string;
  placeholder: string;
  description?: string;
}) {
  return (
    <FormField
      control={form.control}
      name={name}
      render={({ field }) => (
        <FormItem>
          <FormLabel>
            {label}
            <span className="text-muted-foreground" aria-hidden="true">
              {" "}
              *
            </span>
          </FormLabel>
          <Select value={field.value} onValueChange={field.onChange}>
            <FormControl>
              <SelectTrigger aria-required="true">
                <SelectValue placeholder={placeholder} />
              </SelectTrigger>
            </FormControl>
            <SelectContent className="max-h-72">
              {people.map((p) => (
                <SelectItem key={p.id} value={p.id}>
                  {nameOf(p.id)}
                  <span className="ml-2 text-xs text-muted-foreground">
                    {STAGE_LABEL[effectiveBizClass(p)]}
                  </span>
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
          {description && <FormDescription>{description}</FormDescription>}
          <FormMessage />
        </FormItem>
      )}
    />
  );
}
