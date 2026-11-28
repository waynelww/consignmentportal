'use client'

// Renders a list with No Show and Kids in their own labelled sections after
// the rest (Ankle/Half/Crew and other lines keep their order and look).
// Rule: splitOwnSections in lib/products/cut.ts.

import { Fragment, type ReactNode } from 'react'
import { splitOwnSections } from '@/lib/products/cut'

interface Props<T> {
  items: T[]
  productOf: (item: T) => { sku?: string | null; category?: string | null } | null | undefined
  keyOf: (item: T) => string
  renderItem: (item: T) => ReactNode
  /** Extra text after the section label, e.g. "3 SKUs · 12 pairs". */
  sectionNote?: (items: T[]) => string
  headerClassName?: string
  /** Custom section header (e.g. a table row); default is a small labelled bar. */
  renderHeader?: (label: string, note: string | null) => ReactNode
}

export function CutSections<T>({ items, productOf, keyOf, renderItem, sectionNote, headerClassName, renderHeader }: Props<T>) {
  const { main, sections } = splitOwnSections(items, productOf)
  return (
    <>
      {main.map((item) => <Fragment key={keyOf(item)}>{renderItem(item)}</Fragment>)}
      {sections.map((s) => (
        <Fragment key={s.key}>
          {renderHeader ? renderHeader(s.label, sectionNote ? sectionNote(s.items) : null) : <div className={headerClassName ?? 'px-3 py-1.5 bg-gray-50 border-b border-gray-100 text-[10px] font-bold uppercase tracking-wide text-gray-600'}>
            {s.label}
            {sectionNote ? <span className="ml-1 font-normal normal-case tracking-normal text-gray-400">· {sectionNote(s.items)}</span> : null}
          </div>}
          {s.items.map((item) => <Fragment key={keyOf(item)}>{renderItem(item)}</Fragment>)}
        </Fragment>
      ))}
    </>
  )
}
