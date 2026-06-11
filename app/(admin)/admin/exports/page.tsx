'use client'

/**
 * Data Export — one-click CSV downloads of the business-critical data.
 * Exists so a copy of everything can be pulled at any moment, independent of
 * the app or Supabase being healthy. A GitHub Actions job also snapshots all
 * tables nightly and keeps 90 days of backups.
 */

import { useState } from 'react'
import { Download, Database, ShieldCheck, FileSpreadsheet } from 'lucide-react'

function getMYNow() {
  return new Date(new Date().toLocaleString('en-US', { timeZone: 'Asia/Kuala_Lumpur' }))
}

export default function ExportsPage() {
  const now = getMYNow()
  const defaultMonth = `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, '0')}`
  const [salesMonth, setSalesMonth] = useState(defaultMonth)

  const EXPORTS: { title: string; desc: string; href: string }[] = [
    {
      title: 'Commission Summary',
      desc: 'Every monthly invoice: revenue, store commission, amount due to Xocks, paid status, receipt status.',
      href: '/api/admin/export?type=commissions',
    },
    {
      title: 'All Sales (full history)',
      desc: 'Every sale ever recorded, all stores, with SKU and store columns.',
      href: '/api/admin/export?type=sales',
    },
    {
      title: 'Stores',
      desc: 'Full store list with contacts, bank details, commission rates.',
      href: '/api/admin/export?type=stores',
    },
    {
      title: 'Products',
      desc: 'Full product catalogue with prices and Shopify stock.',
      href: '/api/admin/export?type=products',
    },
  ]

  return (
    <div className="space-y-5 max-w-3xl">
      {/* Monthly sales — the headline export */}
      <div className="bg-white rounded-xl shadow-sm border border-gray-100 p-5">
        <div className="flex items-center gap-2 mb-1">
          <FileSpreadsheet size={16} className="text-[#0A0A0A]" />
          <h2 className="text-sm font-semibold text-gray-900">Sales for a Month</h2>
        </div>
        <p className="text-xs text-gray-500 mb-4">
          Every sale from every store for the chosen month — the same data the invoices are computed from.
        </p>
        <div className="flex items-center gap-3">
          <input
            type="month"
            value={salesMonth}
            onChange={(e) => setSalesMonth(e.target.value)}
            className="px-3 py-2 text-sm border border-gray-200 rounded-lg focus:outline-none focus:ring-2 focus:ring-[#FFD700]"
          />
          <a
            href={`/api/admin/export?type=sales&month=${salesMonth}`}
            className="inline-flex items-center gap-2 px-4 py-2 bg-[#0A0A0A] text-white rounded-lg text-sm font-medium hover:bg-gray-800 transition-colors"
          >
            <Download size={14} />
            Download CSV
          </a>
        </div>
      </div>

      {/* Other exports */}
      <div className="grid sm:grid-cols-2 gap-4">
        {EXPORTS.map((e) => (
          <div key={e.title} className="bg-white rounded-xl shadow-sm border border-gray-100 p-5 flex flex-col">
            <div className="flex items-center gap-2 mb-1">
              <Database size={15} className="text-gray-400" />
              <h3 className="text-sm font-semibold text-gray-900">{e.title}</h3>
            </div>
            <p className="text-xs text-gray-500 flex-1">{e.desc}</p>
            <a
              href={e.href}
              className="mt-3 inline-flex items-center gap-1.5 text-sm font-medium text-[#0A0A0A] hover:underline"
            >
              <Download size={13} />
              Download CSV
            </a>
          </div>
        ))}
      </div>

      {/* Reassurance: automatic backups */}
      <div className="bg-green-50 border border-green-100 rounded-xl p-4 flex items-start gap-3">
        <ShieldCheck size={18} className="text-green-600 mt-0.5 shrink-0" />
        <div className="text-xs text-green-800 leading-relaxed">
          <p className="font-semibold mb-0.5">Automatic nightly backups are on</p>
          <p>
            Every night at 4:15 AM a snapshot of all tables (sales, invoices, receipts, stores, products,
            deliveries, stock movements) is saved off-site to GitHub and kept for 90 days — on top of
            Supabase&apos;s own 7-day database backups. Sales are written to the database the moment a store
            taps Save, so a mid-month outage cannot lose already-recorded sales.
          </p>
        </div>
      </div>
    </div>
  )
}
