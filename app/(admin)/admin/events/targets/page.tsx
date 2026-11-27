import { redirect } from 'next/navigation'

// Event Targets now live on each event's page (Targets section); global
// settings are the "Target settings" button on the Events list.
export default function EventTargetsRedirect() {
  redirect('/admin/events')
}
