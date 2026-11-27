import type { Metadata, Viewport } from 'next'

export const metadata: Metadata = {
  title: 'Xocks Event POS',
  robots: { index: false, follow: false },
}

export const viewport: Viewport = {
  themeColor: '#ffffff',
  width: 'device-width',
  initialScale: 1,
  maximumScale: 1,
  userScalable: false,
}

export default function PosLayout({ children }: { children: React.ReactNode }) {
  return <div className="min-h-[100dvh] bg-gray-100">{children}</div>
}
