'use client'

import { useState } from 'react'
import Link from 'next/link'
import { ArrowLeft, Printer, ShoppingCart, Truck, Package, Receipt, Info, Home, ChevronDown, ChevronRight } from 'lucide-react'
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
        title: 'Tap the yellow Sales button (middle of the bottom bar)',
        body: 'It is the big yellow shopping-cart icon in the centre. You will see every in-stock product as a 3-column photo grid.',
      },
      {
        title: 'Tap each product the customer is buying',
        body: 'Each tap adds 1 pair to your cart. Tap the same product twice for 2 pairs. A yellow number badge appears on the product card showing how many are in the cart.',
        tip: 'You can also tap the Scan button (top left of the grid) to scan a barcode.',
      },
      {
        title: 'Open the cart',
        body: 'Tap the cart icon at the top right of the page, or tap the black bar that floats above the bottom nav showing the total.',
      },
      {
        title: 'Adjust quantities or remove items',
        body: 'Inside the cart drawer use the − and + buttons to change quantity. Tap the red trash icon to remove an item entirely.',
      },
      {
        title: 'Tap "Confirm Order"',
        body: 'This is the big black button at the bottom of the cart drawer. After tapping, the stock is deducted and your commission for this month goes up.',
        tip: 'Payment is up to your store — Xocks just records the stock movement. Use your own payment QR / cash.',
      },
      {
        title: 'Made a mistake? Edit it.',
        body: 'Go back to Home tab. Under "Recent Transactions" find the order and tap the yellow "Edit" button. You can change any item\'s quantity or remove an item — the stock returns automatically.',
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
        title: 'Tap the Deliveries tab (far right of the bottom bar)',
        body: 'It is the truck icon. A red number badge appears when there are deliveries waiting.',
      },
      {
        title: 'Find the incoming DO under "Incoming Deliveries"',
        body: 'Status will say Incoming, On the Way, or Arrived. Tap the row to expand it and see every SKU and quantity in the delivery.',
      },
      {
        title: 'Physically count what you received',
        body: 'Compare the list on screen with the actual boxes. Make sure each SKU and quantity matches.',
        tip: 'If anything is missing or damaged, DO NOT tap Receive Stock yet. WhatsApp Xocks ops first.',
      },
      {
        title: 'Tap "Receive Stock"',
        body: 'This is the black button inside the expanded DO. Stock will be added to your inventory immediately — check the Inventory tab to see it.',
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
        title: 'Tap the Inventory tab (the box icon, right of the Sales button)',
        body: 'Low-stock items appear with an amber "Low Stock" tag.',
      },
      {
        title: 'Tap the "Request Restock" button',
        body: 'It is at the top of the inventory page. The next screen pre-selects items already below threshold.',
      },
      {
        title: 'Tick any extra SKUs you want',
        body: 'Tap the checkbox next to each product. The yellow border means the SKU is included.',
      },
      {
        title: 'Adjust quantities using − and +',
        body: 'Default target is 24 pairs per SKU. Minimum total restock is 12 pairs.',
      },
      {
        title: 'Add a note (optional)',
        body: 'If something is urgent, write it in the note box so Xocks ops knows.',
      },
      {
        title: 'Tap "Submit Restock Request"',
        body: 'Xocks ops will review and confirm. You will get a notification (the bell at the top right of the screen) when stock is dispatched.',
      },
    ],
  },
  {
    id: 'view-invoice',
    icon: Receipt,
    title: 'How to View Invoices & Commission',
    intro: 'Track how much you have earned each month and download invoices for your records.',
    color: 'bg-purple-100 text-purple-800',
    steps: [
      {
        title: 'Tap the Info tab (the "i" icon, second from the left)',
        body: 'This is your profile / settings hub. Scroll to find Commissions & Invoices, or use the link below.',
        tip: 'Direct link from the Home tab: tap "View All" next to Recent Transactions, then back to Info → Commissions.',
      },
      {
        title: 'See this month live',
        body: 'A big black card at the top shows pairs sold, revenue, and your commission so far this month.',
      },
      {
        title: 'Past invoices are listed below',
        body: 'Each row: month, status (Pending / Approved / Paid / Disputed), pairs sold, revenue, your commission.',
      },
      {
        title: 'Tap the "Invoice" button on a row',
        body: 'A PDF opens in a new tab. You can download, print, or share it.',
      },
      {
        title: 'When are invoices generated?',
        body: 'Automatically on the 1st of every month for the previous month. No action needed from you.',
      },
      {
        title: 'Status meanings',
        body: 'Pending = waiting for Xocks to confirm. Approved = ready for payment. Paid = Xocks has paid you. Disputed = there is an issue, contact ops.',
      },
    ],
  },
  {
    id: 'change-password',
    icon: Info,
    title: 'How to Change Your Password',
    intro: 'You should change the temporary password Xocks gave you right after first login.',
    color: 'bg-rose-100 text-rose-800',
    steps: [
      {
        title: 'Log in with the temporary password from Xocks',
        body: 'Use the link, email, and password the Xocks team sent you via WhatsApp.',
      },
      {
        title: 'Tap the Info tab at the bottom (the "i" icon)',
        body: 'This opens your profile.',
      },
      {
        title: 'Tap "Change Password"',
        body: 'Enter a new strong password (at least 8 characters, mix of letters and numbers).',
      },
      {
        title: 'Tap Save',
        body: 'Done. Next time you log in, use the new password.',
        tip: 'Forgot your password? Tap "Forgot password?" on the login screen — Xocks will send a reset link.',
      },
    ],
  },
  {
    id: 'navigation',
    icon: Home,
    title: 'Understanding the Bottom Tabs',
    intro: 'There are 5 tabs at the bottom of every page. Here is what each one does.',
    color: 'bg-indigo-100 text-indigo-800',
    steps: [
      {
        title: 'Home (house icon, far left)',
        body: 'Today\'s sales summary, this month vs last month earnings, recent transactions (with Edit button), and shortcuts to Record a Sale and Request Restock.',
      },
      {
        title: 'Info ("i" icon, second from left)',
        body: 'Your store profile, payment QR, commissions & invoices, change password.',
      },
      {
        title: 'Sales (big yellow cart icon, middle)',
        body: 'Record a customer sale. This is the most-used button.',
      },
      {
        title: 'Inventory (box icon, fourth from left)',
        body: 'See what stock you have. Request restock from here when items get low.',
      },
      {
        title: 'Deliveries (truck icon, far right)',
        body: 'Confirm incoming deliveries from Xocks. A red badge shows when you have something to action.',
      },
    ],
  },
]

export default function HelpPage() {
  const [openSection, setOpenSection] = useState<string | null>('record-sale')

  function handlePrint() {
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
        <p className="text-gray-300 text-sm mt-1">Step-by-step for every button and tab</p>
      </div>

      {/* Welcome */}
      <div className="bg-white rounded-xl shadow-sm p-5 mb-5">
        <h2 className="text-base font-bold text-[#0A0A0A] mb-2">Welcome to Xocks</h2>
        <p className="text-sm text-gray-600 leading-relaxed">
          {`This app helps you sell socks on consignment. You don't pay upfront — Xocks delivers stock, you sell it at your store, you keep your commission. Open this guide whenever you forget how something works.`}
        </p>
        <div className="mt-3 grid grid-cols-5 gap-1 text-center text-[10px]">
          <div className="rounded-lg bg-gray-50 px-1 py-2"><Home size={14} className="mx-auto mb-1 text-gray-600" /><p className="font-semibold text-gray-700">Home</p></div>
          <div className="rounded-lg bg-gray-50 px-1 py-2"><Info size={14} className="mx-auto mb-1 text-gray-600" /><p className="font-semibold text-gray-700">Info</p></div>
          <div className="rounded-lg bg-[#FFD700]/30 px-1 py-2"><ShoppingCart size={14} className="mx-auto mb-1 text-[#0A0A0A]" /><p className="font-bold text-[#0A0A0A]">Sales</p></div>
          <div className="rounded-lg bg-gray-50 px-1 py-2"><Package size={14} className="mx-auto mb-1 text-gray-600" /><p className="font-semibold text-gray-700">Inventory</p></div>
          <div className="rounded-lg bg-gray-50 px-1 py-2"><Truck size={14} className="mx-auto mb-1 text-gray-600" /><p className="font-semibold text-gray-700">Deliveries</p></div>
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
