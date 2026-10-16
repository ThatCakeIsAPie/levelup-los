import { useLayoutEffect, useRef, type ComponentProps } from "react";
import { Input } from "@/components/ui/input";
import { caretAfter, digitsBefore, formatPhone, normalizePhone } from "@/lib/phone";

/**
 * A phone field that formats as you type, US style "(512) 555-0102" (see
 * src/lib/phone.ts; +1 and other country codes are accepted). On blur the
 * value becomes the stored form, so what you see is what gets saved. The
 * caret stays after the digit you just typed or deleted.
 */
export function PhoneInput({
  value,
  onValueChange,
  onBlur,
  ...props
}: Omit<ComponentProps<typeof Input>, "value" | "onChange" | "type"> & {
  value: string;
  onValueChange: (value: string) => void;
}) {
  const ref = useRef<HTMLInputElement>(null);
  const caret = useRef<number | null>(null);

  useLayoutEffect(() => {
    const el = ref.current;
    if (el && caret.current !== null && document.activeElement === el) {
      el.setSelectionRange(caret.current, caret.current);
    }
    caret.current = null;
  });

  return (
    <Input
      {...props}
      ref={ref}
      type="tel"
      inputMode="tel"
      autoComplete={props.autoComplete ?? "tel"}
      value={value}
      onChange={(e) => {
        let raw = e.target.value;
        let pos = e.target.selectionStart ?? raw.length;
        const native = e.nativeEvent as InputEvent;
        // Backspace over a ")", " " or "-" deletes the digit before it instead.
        if (
          native.inputType === "deleteContentBackward" &&
          raw.replace(/\D/g, "") === value.replace(/\D/g, "") &&
          raw.length < value.length
        ) {
          const before = raw.slice(0, pos);
          const i = before.search(/\d(?=\D*$)/);
          if (i >= 0) {
            raw = raw.slice(0, i) + raw.slice(i + 1);
            pos = i;
          }
        }
        const next = formatPhone(raw);
        caret.current = caretAfter(next, digitsBefore(raw, pos));
        onValueChange(next);
      }}
      onBlur={(e) => {
        const stored = normalizePhone(value);
        if (stored !== value) onValueChange(stored);
        onBlur?.(e);
      }}
    />
  );
}
