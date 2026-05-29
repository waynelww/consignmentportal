'use client'

import { useState } from 'react'
import Link from 'next/link'
import { ArrowLeft, Printer, ShoppingCart, Truck, Package, Receipt, CreditCard, User, ChevronDown, ChevronRight } from 'lucide-react'
import { cn } from '@/lib/utils'

interface GuideStep {
  title: string
  body: string
  tip?: string
}

interface GuideSection {
  id: string
  icon: React.ComponentType<{ size?: number; className?: string }>
  title: string
  intro: string
  steps: GuideStep[]
  color: string
}

const SECTIONS: GuideSection[] = [
  {
    id: 'record-sale',
    icon: ShoppingCart,
    title: 'How to Record a Sale',
    intro: 'When a customer buys socks, record it here so your stock and commission update automatically.',
    color: 'bg-yellow-100 text-yellow-800',
    steps: [
      {
        title: 'Tap the big yellow Sale button at the bottom',
        body: 'You\'ll see all your in-stock products as a 3-column grid with photos.',
      },
      {
        title: 'Tap each product the customer is buying',
        body: 'Each tap adds 1 pair to your cart. Tap the same product twice for 2 pairs. A yellow badge will show on the product card.',
        tip: 'You can also scan the barcode by tapping the "Scan" button on the left.',
      },
      {
        title: 'Open the cart',
        body: 'Tap the cart button at the top right or the black bar at the bottom to review your order.',
      },
      {
        title: 'Adjust quantities if needed',
        body: 'Use the + and − buttons. Tap the red trash icon to remove an item.',
      },
      {
        title: 'Tap "Confirm Order"',
        body: 'Your stock will be deducted automatically and your commission will be added to this month\'s total.',
        tip: 'Payment handling is up to your store — Xocks just records the stock movement.',
      },
      {
        title: 'Made a mistake?',
        body: 'Go to History tab → tap the pencil icon next to any sale to edit the quantity. The change is logged for audit.',
      },
    ],
  },
  {
    id: 'receive-do',
    icon: Truck,
    title: 'How to Receive a Delivery (DO)',
    intro: 'When Xocks sends you new stock, confirm receipt here so your inventory updates.',
    color: 'bg-blue-100 text-blue-800',
    steps: [
      {
        title: 'Open the Account tab → Delivery Orders',
        body: 'Or tap the notification when a new DO arrives.',
      },
      {
        title: 'Find the incoming DO (status: Incoming / On the Way / Arrived)',
        body: 'Tap the row to expand it and see all SKUs and quantities.',
      },
      {
        title: 'Physically count what you received',
        body: 'Compare the list on screen with the actual boxes you received.',
        tip: 'If anything is wrong (missing items, damaged stock), DO NOT tap Receive Stock yet. Contact Xocks ops first.',
      },
      {
        title: 'Tap "Receive Stock"',
        body: 'Stock will be added to your inventory immediately. You\'ll see it appear under the Stock tab.',
      },
    ],
  },
  {
    id: 'request-restock',
    icon: Package,
    title: 'How to Request Restock',
    intro: 'When your stock is running low, request more from Xocks here.',
    color: 'bg-green-100 text-green-800',
    steps: [
      {
        title: 'Open Stock tab',
        body: 'You\'ll see low-stock items highlighted in amber.',
      },
      {
        title: 'Tap "Request Restock" button',
        body: 'Items already below threshold are pre-selected for you.',
      },
      {
        title: 'Tick any extra SKUs you want',
        body: 'Tap the checkbox next to each product. The yellow border means it\'s selected.',
      },
      {
        title: 'Adjust quantities using + and −',
        body: 'Minimum total restock is 12 pairs. The default target is 24 pairs per SKU.',
      },
      {
        title: 'Add a note (optional)',
        body: 'Anything urgent? Write it here so ops knows.',
      },
      {
        title: 'Tap "Submit Restock Request"',
        body: 'Xocks ops will review and confirm. You\'ll get a notification when stock is on the way.',
      },
    ],
  },
  {
    id: 'view-invoice',
    icon: Receipt,
    title: 'How to View Invoices & Commission',
    intro: 'Track how much you\'ve earned each month and download invoices for your records.',
    color: 'bg-purple-100 text-purple-800',
    steps: [
      {
        title: 'Open Account tab → Commissions',
        body: 'You\'ll see a live card showing this month\'s earnings: pairs sold, revenue, and commission.',
      },
      {
        title: 'Past invoices are listed below',
        body: 'Each row shows the month, status (Pending, Approved, Paid), pairs sold, revenue, and your commission.',
      },
      {
        title: 'Tap the "Invoice" button',
        body: 'A PDF invoice opens in a new tab. You can download, print, or share it.',
      },
      {
        title: 'When is each invoice generated?',
        body: 'Automatically on the 1st of every month for the previous month\'s sales. No action needed.',
      },
      {
        title: 'Status meanings',
        body: 'Pending = waiting for Xocks to confirm. Approved = ready for payment. Paid = Xocks has paid you. Disputed = there\'s an issue, contact ops.',
      },
    ],
  },
  {
    id: 'payment-setup',
    icon: CreditCard,
    title: 'Where to Set Up Your Payment QR',
    intro: 'Add your DuitNow / TNG / bank QR link so payments are easy.',
    color: 'bg-teal-100 text-teal-800',
    steps: [
      {
        title: 'Open Account tab → Profile',
        body: 'Scroll to the "Payment QR" section.',
      },
      {
        title: 'Paste your payment QR link',
        body: 'This is the URL behind your DuitNow / TNG / Boost / MAE QR. You can copy it from your banking app.',
        tip: 'Not sure how? Open your banking app → "My QR code" → "Share" → "Copy link".',
      },
      {
        title: 'Tap Save',
        body: 'Done! Your customers can now scan your QR for cashless payment.',
      },
      {
        title: 'Important: this is YOUR payment gateway',
        body: 'Xocks does not touch the customer\'s payment. Money goes straight to your bank. Xocks just deducts commission monthly via invoice.',
      },
    ],
  },
  {
    id: 'change-password',
    icon: User,
    title: 'How to Change Your Password',
    intro: 'You should change your temporary password right after first login for security.',
    color: 'bg-rose-100 text-rose-800',
    steps: [
      {
        title: 'Log in with your temporary password',
        body: 'Use the link, email, and password Xocks sent you.',
      },
      {
        title: 'Tap the Account tab at the bottom right',
        body: 'You\'ll see your store info and settings.',
      },
      {
        title: 'Tap "Change Password"',
        body: 'Enter a new strong password (at least 8 characters, mix of letters and numbers).',
      },
      {
        title: 'Tap Save',
        body: 'Done. Next time you log in, use the new password.',
        tip: 'Forgot your password later? Tap "Forgot password?" on the login screen.',
      },
    ],
  },
]

export default function HelpPage() {
  const [openSection, setOpenSection] = useState<string | null>('record-sale')

  function handlePrint() {
    // Open all sections before printing
    document.querySelectorAll<HTMLDetailsElement>('.guide-section').forEach((el) => el.classList.add('print-open'))
    window.print()
  }

  return (
    <div className="px-4 py-5 max-w-2xl mx-auto pb-12">
      {/* Print styles */}
      <style jsx global>{`
        @media print {
          .no-print { display: none !important; }
          .guide-section .guide-body { display: block !important; }
          body { background: white; }
          .print-show { display: block !important; }
          .page-break { page-break-after: always; }
        }
      `}</style>

      {/* Header */}
      <div className="no-print flex items-center justify-between mb-4">
        <Link href="/store/dashboard" className="flex items-center gap-1.5 text-sm text-gray-500 hover:text-gray-800 transition-colors">
          <ArrowLeft size={16} />
          Back
        </Link>
        <button
          onClick={handlePrint}
          className="flex items-center gap-1.5 text-xs font-semibold text-[#0A0A0A] bg-[#FFD700] px-3 py-2 rounded-lg"
        >
          <Printer size={14} />
          Print / Save PDF
        </button>
      </div>

      {/* Title */}
      <div className="bg-[#0A0A0A] rounded-2xl p-6 mb-5 text-center">
        <h1 className="text-2xl font-bold text-[#FFD700]">Store Owner Guide</h1>
        <p className="text-gray-300 text-sm mt-1">Step-by-step instructions for every flow</p>
      </div>

      {/* Welcome */}
      <div className="bg-white rounded-xl shadow-sm p-5 mb-5">
        <h2 className="text-base font-bold text-[#0A0A0A] mb-2">Welcome to Xocks 🧦</h2>
        <p className="text-sm text-gray-600 leading-relaxed">
          {`This app helps you sell socks on consignment. You don't buy stock upfront — Xocks delivers, you sell, and you keep your commission. Use this guide whenever you forget how something works.`}
        </p>
        <div className="mt-3 grid grid-cols-2 gap-2 text-xs">
          <div className="bg-gray-50 rounded-lg px-3 py-2">
            <p className="text-gray-500">Bottom nav</p>
            <p className="font-semibold text-gray-700">5 main tabs</p>
          </div>
          <div className="bg-gray-50 rounded-lg px-3 py-2">
            <p className="text-gray-500">Big yellow button</p>
            <p className="font-semibold text-gray-700">Record a sale</p>
          </div>
        </div>
      </div>

      {/* Sections */}
      <div className="space-y-3">
        {SECTIONS.map((section) => {
          const isOpen = openSection === section.id
          const Icon = section.icon
          return (
            <div key={section.id} className="guide-section bg-white rounded-xl shadow-sm overflow-hidden">
              <button
                onClick={() => setOpenSection(isOpen ? null : section.id)}
                className="w-full px-4 py-4 flex items-center gap-3 text-left no-print"
              >
                <div className={cn('w-10 h-10 rounded-xl flex items-center justify-center shrink-0', section.color)}>
                  <Icon size={20} />
                </div>
                <div className="flex-1 min-w-0">
                  <p className="text-sm font-bold text-[#0A0A0A]">{section.title}</p>
                  <p className="text-xs text-gray-500 truncate">{section.intro}</p>
                </div>
                {isOpen ? (
                  <ChevronDown size={16} className="text-gray-400 shrink-0" />
                ) : (
                  <ChevronRight size={16} className="text-gray-400 shrink-0" />
                )}
              </button>

              {/* Print-only header */}
              <div className="hidden print-show px-4 pt-4 pb-2">
                <h2 className="text-lg font-bold text-[#0A0A0A]">{section.title}</h2>
                <p className="text-sm text-gray-600">{section.intro}</p>
              </div>

              <div className={cn('guide-body px-4 pb-5', isOpen ? 'block' : 'hidden')}>
                <ol className="space-y-3 mt-2">
                  {section.steps.map((step, i) => (
                    <li key={i} className="flex gap-3">
                      <div className="w-7 h-7 rounded-full bg-[#0A0A0A] text-[#FFD700] flex items-center justify-center text-xs font-bold shrink-0">
                        {i + 1}
                      </div>
                      <div className="flex-1">
                        <p className="text-sm font-semibold text-[#0A0A0A]">{step.title}</p>
                        <p className="text-xs text-gray-600 mt-0.5 leading-relaxed">{step.body}</p>
                        {step.tip && (
                          <div className="mt-1.5 bg-amber-50 border border-amber-200 rounded-lg px-2.5 py-1.5">
                            <p className="text-xs text-amber-800">💡 {step.tip}</p>
                          </div>
                        )}
                      </div>
                    </li>
                  ))}
                </ol>
              </div>
            </div>
          )
        })}
      </div>

      {/* Footer / support */}
      <div className="mt-6 bg-gradient-to-br from-amber-50 to-yellow-50 border border-amber-200 rounded-xl p-5 text-center">
        <p className="text-sm font-semibold text-[#0A0A0A]">Still stuck?</p>
        <p className="text-xs text-gray-600 mt-1">
          {`WhatsApp Xocks ops team anytime. We'll guide you through it.`}
        </p>
      </div>
    </div>
  )
}
