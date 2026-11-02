// Privacy notice for the Xocks HR link. Public (proxy lets /hr/* through);
// also the privacy policy URL on the "Xocks HR" Google OAuth consent screen.

export const metadata = { title: 'Xocks HR — Privacy' }

export default function HrPrivacyPage() {
  return (
    <div className="min-h-full bg-[#F5F5F5]">
      <header className="bg-[#0A0A0A] px-4 py-3">
        <span className="text-[#FFD700] font-black text-xl tracking-tight">XOCKS</span>
        <span className="text-white/50 text-xs font-medium ml-2">HR</span>
      </header>
      <main className="max-w-2xl mx-auto p-6 space-y-4 text-sm text-gray-700 leading-relaxed">
        <h1 className="text-xl font-bold text-gray-900">Privacy notice</h1>
        <p>
          Xocks HR is the internal staff system of Wayne Group Holding Sdn Bhd (Xocks). It is used only by
          Xocks staff to submit expense claims, leave and medical certificates.
        </p>
        <h2 className="font-semibold text-gray-900">What we keep</h2>
        <p>
          Your name, the claims, leave and MC requests you submit, the receipts and MC slips you upload, any
          late penalties recorded for you, and a log of sign-ins and changes (time, IP address and device type).
        </p>
        <h2 className="font-semibold text-gray-900">How it is used</h2>
        <p>
          Only to process your claims, leave and MC, to prepare the monthly HR report for management, and to
          keep a record of who changed what. It is not sold or shared with anyone outside Xocks.
        </p>
        <h2 className="font-semibold text-gray-900">Google Drive</h2>
        <p>
          The company administrator can connect a Google Drive account so that approved receipts and MC slips are
          also saved there. The app only has access to the files and folders it creates in that Drive
          (Google&apos;s &ldquo;drive.file&rdquo; permission) and cannot see anything else in it.
        </p>
        <h2 className="font-semibold text-gray-900">Questions</h2>
        <p>Contact hello@xocks.co.</p>
      </main>
    </div>
  )
}
