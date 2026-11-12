// How people join events, quick attendance and missed-event follow-ups (MVP
// plan "Events"). The kinds of event are the team's categories
// (src/data/eventCategories).
export { EVENT_FORMAT_LABEL, MODE_LABEL, canManageEvents } from "./info";
export { MAX_TICKET_URL, cleanTicketUrl, ticketHost } from "./ticketLink";
export {
  MISSED_WINDOW_DAYS,
  missedAudience,
  missedEventStreaks,
  openMissedFollowUps,
  type MissedHandled,
  type MissedInput,
  type MissedStreak,
} from "./missed";
export {
  addMissedNote,
  removeMissedNote,
  setEventAttendance,
  useCanFollowUpMissed,
  useCanManageEvents,
  useMissedAtEvent,
  useMissedFollowUps,
  useMissedForPerson,
  useMissedNotes,
  useMissedStreaks,
} from "./hooks";
