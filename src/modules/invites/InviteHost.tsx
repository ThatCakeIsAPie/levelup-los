import { useEffect } from "react";
import { usePerson } from "@/data";
import { closeInviteDialog, useInviteDialogStore } from "./inviteDialogStore";
import { InvitePersonDialog } from "./InvitePersonDialog";
import { usePersonSignIn } from "./personInvites";

/**
 * Renders the person-invite dialog once for the whole app (mounted in the app
 * shell). After a registration the dialog only stays if the viewer may invite
 * that person (a candidate who already signs in has nothing to be invited to).
 */
export function InviteHost() {
  const request = useInviteDialogStore((s) => s.request);
  return (
    <>
      <InvitePersonDialog request={request} onClose={() => closeInviteDialog()} />
      {request?.mode === "congrats" && <CongratsGate personId={request.personId} />}
    </>
  );
}

/** Closes the "Congrats" dialog when it turns out there is nobody to invite. */
function CongratsGate({ personId }: { personId: string }) {
  const person = usePerson(personId);
  if (!person) return null;
  return <Gate personId={personId} person={person} />;
}

function Gate({
  personId,
  person,
}: {
  personId: string;
  person: NonNullable<ReturnType<typeof usePerson>>;
}) {
  const { ready, eligible } = usePersonSignIn(person);
  useEffect(() => {
    if (ready && !eligible) closeInviteDialog(personId);
  }, [ready, eligible, personId]);
  return null;
}
