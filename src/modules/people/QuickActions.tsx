import { Button } from "@/components/ui/button";
import type { CrmPerson } from "@/stores/peopleStore";
import { Mail, Phone, MessageSquare, Copy } from "lucide-react";
import { toast } from "sonner";

export function QuickActions({ person }: { person: CrmPerson }) {
  const script = `Hey ${person.name.split(" ")[0]}! Quick note about the upcoming event — wanted to make sure you're in the loop. Got a sec to chat?`;

  return (
    <div className="flex flex-wrap gap-2">
      {person.email && (
        <Button asChild size="sm" variant="outline">
          <a href={`mailto:${person.email}`}>
            <Mail className="h-3.5 w-3.5" /> Email
          </a>
        </Button>
      )}
      {person.phone && (
        <>
          <Button asChild size="sm" variant="outline">
            <a href={`tel:${person.phone}`}>
              <Phone className="h-3.5 w-3.5" /> Call
            </a>
          </Button>
          <Button asChild size="sm" variant="outline">
            <a href={`sms:${person.phone}`}>
              <MessageSquare className="h-3.5 w-3.5" /> SMS
            </a>
          </Button>
        </>
      )}
      <Button
        size="sm"
        variant="outline"
        onClick={() => {
          navigator.clipboard.writeText(script);
          toast.success("Follow-up script copied");
        }}
      >
        <Copy className="h-3.5 w-3.5" /> Copy script
      </Button>
    </div>
  );
}
