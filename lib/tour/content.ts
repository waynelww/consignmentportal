// Store owner guided tour: copy and step definitions.
// Client-safe (no server imports). Step ids are stable and stored in
// profiles.tour_step, so do not renumber without a data migration.

export type Lang = 'en' | 'bm'

export interface Bilingual {
  en: string
  bm: string
}

export interface TourStep {
  id: number
  /** Store route this step is on. Its bottom-nav tab is lit up. */
  page: string
  /** Small-caps tab label shown on the card. */
  tab: Bilingual
  title: Bilingual
  body: Bilingual
  /** CSS selectors, tried in order. The first visible match is highlighted. */
  targets: string[]
  /** Step 15 only: shown only while the store has an unsigned first DO. */
  onlyIfUnsignedFirstDO?: boolean
}

const NAV = {
  home: '/store/dashboard',
  sales: '/store/record-sale',
  inventory: '/store/inventory',
  deliveries: '/store/delivery-orders',
  info: '/store/profile',
} as const

const navTab = (page: string) => `nav a[href="${page}"]`

export const TOUR_STEPS: TourStep[] = [
  {
    id: 1, page: NAV.home,
    tab: { en: 'Home', bm: 'Home' },
    title: { en: 'Home: your daily summary', bm: 'Home: ringkasan harian anda' },
    body: {
      en: 'This is the first screen you see. Everything important for today is here.',
      bm: 'Ini skrin pertama yang anda lihat. Semua perkara penting untuk hari ini ada di sini.',
    },
    targets: [navTab(NAV.home)],
  },
  {
    id: 2, page: NAV.home,
    tab: { en: 'Home', bm: 'Home' },
    title: { en: "Today's sales", bm: 'Jualan hari ini' },
    body: {
      en: "How much you've sold today, in ringgit and pairs. It updates as soon as a sale is recorded.",
      bm: 'Jumlah jualan anda hari ini, dalam ringgit dan pasang. Dikemas kini sebaik sahaja jualan direkod.',
    },
    targets: ['[data-tour="home-today"]'],
  },
  {
    id: 3, page: NAV.home,
    tab: { en: 'Home', bm: 'Home' },
    title: { en: 'Earnings this month', bm: 'Pendapatan bulan ini' },
    body: {
      en: "Your total sales this month and the commission you've earned so far.",
      bm: 'Jumlah jualan bulan ini dan komisen yang telah anda peroleh setakat ini.',
    },
    targets: ['[data-tour="home-earnings"]'],
  },
  {
    id: 4, page: NAV.home,
    tab: { en: 'Home', bm: 'Home' },
    title: { en: 'Request Restock & Promos', bm: 'Mohon Stok Semula & Promosi' },
    body: {
      en: 'Request Restock asks Xocks for more stock. Promos shows any promotions you can offer customers.',
      bm: 'Request Restock untuk meminta stok tambahan daripada Xocks. Promos menunjukkan promosi yang boleh ditawarkan kepada pelanggan.',
    },
    targets: ['[data-tour="home-actions"]'],
  },
  {
    id: 5, page: NAV.home,
    tab: { en: 'Home', bm: 'Home' },
    title: { en: 'Recent sales & fixing mistakes', bm: 'Jualan terkini & membetulkan kesilapan' },
    body: {
      en: 'Your latest sales. Tap Edit to fix a wrong product or quantity. Tap View all for your full Sales History, which you can filter by date or product.',
      bm: 'Jualan terkini anda. Tekan Edit untuk membetulkan produk atau kuantiti yang salah. Tekan View all untuk Sejarah Jualan penuh, boleh ditapis mengikut tarikh atau produk.',
    },
    targets: ['[data-tour="home-recent"]'],
  },
  {
    id: 6, page: NAV.home,
    tab: { en: 'Top bar', bm: 'Bar atas' },
    title: { en: 'Notifications', bm: 'Notifikasi' },
    body: {
      en: 'The bell shows messages from Xocks, like deliveries on the way and new invoices. A red number means something new.',
      bm: 'Loceng menunjukkan mesej daripada Xocks, seperti penghantaran dalam perjalanan dan invois baharu. Nombor merah bermaksud ada sesuatu yang baharu.',
    },
    targets: ['a[href="/store/notifications"]'],
  },
  {
    id: 7, page: NAV.sales,
    tab: { en: 'Sales', bm: 'Sales' },
    title: { en: 'Sales: record every pair you sell', bm: 'Jualan: rekod setiap pasang yang dijual' },
    body: {
      en: 'The big yellow button. Use it every time a customer buys Xocks socks, on the same day, so your stock and earnings stay correct.',
      bm: 'Butang kuning besar. Gunakannya setiap kali pelanggan membeli stokin Xocks, pada hari yang sama, supaya stok dan pendapatan anda tepat.',
    },
    targets: [navTab(NAV.sales)],
  },
  {
    id: 8, page: NAV.sales,
    tab: { en: 'Sales', bm: 'Sales' },
    title: { en: 'Keyed in by', bm: 'Direkod oleh' },
    body: {
      en: 'Pick who is recording the sale, so you know which staff member keyed it in.',
      bm: 'Pilih siapa yang merekod jualan, supaya anda tahu staf mana yang memasukkannya.',
    },
    // Lives in the cart drawer; falls back to the cart bar, then the search row.
    targets: ['[data-tour="sale-keyed-by"]', '[data-tour="sale-cart-bar"]', '[data-tour="sale-search"]'],
  },
  {
    id: 9, page: NAV.sales,
    tab: { en: 'Sales', bm: 'Sales' },
    title: { en: 'Find the product', bm: 'Cari produk' },
    body: {
      en: 'Type the name or SKU (e.g. A21), or tap the camera to scan the barcode on the sock.',
      bm: 'Taip nama atau SKU (cth. A21), atau tekan kamera untuk imbas kod bar pada stokin.',
    },
    targets: ['[data-tour="sale-search"]'],
  },
  {
    id: 10, page: NAV.sales,
    tab: { en: 'Sales', bm: 'Sales' },
    title: { en: 'Cart & promo code', bm: 'Troli & kod promosi' },
    body: {
      en: 'Adjust quantities with − and +. If the customer has a promo code, tap Have a code? to apply it.',
      bm: 'Laraskan kuantiti dengan − dan +. Jika pelanggan ada kod promosi, tekan Have a code? untuk menggunakannya.',
    },
    targets: ['[data-tour="sale-promo"]', '[data-tour="sale-cart-bar"]', '[data-tour="sale-search"]'],
  },
  {
    id: 11, page: NAV.sales,
    tab: { en: 'Sales', bm: 'Sales' },
    title: { en: 'Confirm Order', bm: 'Sahkan Pesanan' },
    body: {
      en: 'Check the cart, then tap Confirm Order. The sale is saved and your stock goes down automatically.',
      bm: 'Semak troli, kemudian tekan Confirm Order. Jualan disimpan dan stok anda berkurang secara automatik.',
    },
    targets: ['[data-tour="sale-confirm"]', '[data-tour="sale-cart-bar"]', '[data-tour="sale-search"]'],
  },
  {
    id: 12, page: NAV.inventory,
    tab: { en: 'Inventory', bm: 'Inventory' },
    title: { en: 'Inventory: your stock', bm: 'Inventori: stok anda' },
    body: {
      en: 'How many pairs you have in the shop right now.',
      bm: 'Berapa pasang yang ada di kedai anda sekarang.',
    },
    targets: ['[data-tour="inv-total"]', '[data-tour="inv-filters"]'],
  },
  {
    id: 13, page: NAV.inventory,
    tab: { en: 'Inventory', bm: 'Inventory' },
    title: { en: 'Filter your stock', bm: 'Tapis stok anda' },
    body: {
      en: "Tap Low stock or Out of stock to see what's running out. Then use Request Restock on Home.",
      bm: 'Tekan Low stock atau Out of stock untuk melihat apa yang hampir habis. Kemudian gunakan Request Restock di Home.',
    },
    targets: ['[data-tour="inv-filters"]'],
  },
  {
    id: 14, page: NAV.deliveries,
    tab: { en: 'Deliveries', bm: 'Deliveries' },
    title: { en: 'Receiving stock', bm: 'Menerima stok' },
    body: {
      en: 'When Xocks sends stock, it appears under Incoming Deliveries. Count what arrived, then tap Receive Stock. A red number on this tab means something needs you.',
      bm: 'Apabila Xocks menghantar stok, ia muncul di bawah Incoming Deliveries. Kira apa yang tiba, kemudian tekan Receive Stock. Nombor merah pada tab ini bermaksud ada yang perlu tindakan anda.',
    },
    targets: ['[data-tour="do-incoming"]'],
  },
  {
    id: 15, page: NAV.deliveries,
    tab: { en: 'Deliveries', bm: 'Deliveries' },
    title: { en: 'Sign the delivery order', bm: 'Tandatangan pesanan penghantaran' },
    body: {
      en: 'After receiving, tap Sign & Save to sign the DO on your phone. Your first delivery is waiting here.',
      bm: 'Selepas menerima, tekan Sign & Save untuk menandatangani DO di telefon anda. Penghantaran pertama anda sedang menunggu di sini.',
    },
    targets: ['[data-tour="do-signature"]', '[data-tour="do-incoming"]'],
    onlyIfUnsignedFirstDO: true,
  },
  {
    id: 16, page: NAV.deliveries,
    tab: { en: 'Deliveries', bm: 'Deliveries' },
    title: { en: 'Past deliveries', bm: 'Penghantaran lepas' },
    body: {
      en: "Every delivery you've received, with the signed copy to view any time.",
      bm: 'Semua penghantaran yang telah diterima, dengan salinan bertandatangan untuk dilihat bila-bila masa.',
    },
    targets: ['[data-tour="do-previous"]', '[data-tour="do-incoming"]'],
  },
  {
    id: 17, page: NAV.info,
    tab: { en: 'Info', bm: 'Info' },
    title: { en: 'Info: commission this month', bm: 'Info: komisen bulan ini' },
    body: {
      en: 'Your commission so far this month, live.',
      bm: 'Komisen anda setakat ini bulan ini, secara langsung.',
    },
    targets: ['[data-tour="info-commission"]'],
  },
  {
    id: 18, page: NAV.info,
    tab: { en: 'Info', bm: 'Info' },
    title: { en: 'Past invoices', bm: 'Invois lepas' },
    body: {
      en: 'Your invoice arrives on the 1st of each month. Tap Invoice to open or download it.',
      bm: 'Invois anda tiba pada 1hb setiap bulan. Tekan Invoice untuk membuka atau memuat turunnya.',
    },
    targets: ['[data-tour="info-invoices"]'],
  },
  {
    id: 19, page: NAV.info,
    tab: { en: 'Info', bm: 'Info' },
    title: { en: 'Paying Xocks', bm: 'Membuat bayaran kepada Xocks' },
    body: {
      en: 'Scan the DuitNow QR to pay your balance, and use the Payment Reference shown so we can match your payment. After paying, tap Upload receipt on the invoice so we can confirm it.',
      bm: 'Imbas DuitNow QR untuk membayar baki, dan gunakan Payment Reference yang ditunjukkan supaya kami dapat memadankan bayaran anda. Selepas membayar, tekan Upload receipt pada invois supaya kami boleh mengesahkannya.',
    },
    targets: ['[data-tour="info-pay"]'],
  },
  {
    id: 20, page: NAV.info,
    tab: { en: 'Info', bm: 'Info' },
    title: { en: 'Change your password', bm: 'Tukar kata laluan anda' },
    body: {
      en: 'You logged in with a temporary password from Xocks. Please change it here to one only you know.',
      bm: 'Anda log masuk dengan kata laluan sementara daripada Xocks. Sila tukar di sini kepada kata laluan yang hanya anda tahu.',
    },
    targets: ['[data-tour="info-security"]'],
  },
  {
    id: 21, page: NAV.home,
    tab: { en: 'Home', bm: 'Home' },
    title: { en: 'Need help later?', bm: 'Perlukan bantuan nanti?' },
    body: {
      en: 'Tap Tutorial Guide any time to replay this tour or read the step-by-step guides.',
      bm: 'Tekan Tutorial Guide bila-bila masa untuk mengulang lawatan ini atau membaca panduan langkah demi langkah.',
    },
    targets: ['[data-tour="home-guide"]'],
  },
]

/** Copy for the welcome, offer, resume and finish sheets and the card controls. */
export const TOUR_UI = {
  welcome: {
    emoji: '👋',
    title: (store: string): Bilingual => ({ en: `Welcome to XCMS, ${store}!`, bm: `Selamat datang ke XCMS, ${store}!` }),
    body: {
      en: "This is where you record Xocks sales, check your stock, receive deliveries and see what you've earned. Let's take a quick tour of each tab and where everything is.",
      bm: 'Di sini anda merekod jualan Xocks, menyemak stok, menerima penghantaran dan melihat apa yang telah anda peroleh. Mari lawati setiap tab dan lihat di mana semuanya.',
    },
  },
  offer: {
    emoji: '✨',
    title: { en: 'New: a quick tour of XCMS', bm: 'Baharu: lawatan ringkas XCMS' },
    body: {
      en: 'Want a 2-minute walkthrough of every tab and where everything is? You can also start it any time from Tutorial Guide on Home.',
      bm: 'Mahu lawatan 2 minit untuk setiap tab dan tempat semuanya? Anda juga boleh mulakan bila-bila masa dari Tutorial Guide di Home.',
    },
  },
  resume: {
    emoji: '▶️',
    title: { en: 'Continue your tour?', bm: 'Teruskan lawatan anda?' },
    body: (n: number, m: number): Bilingual => ({
      en: `You stopped at step ${n} of ${m}. Pick up where you left off?`,
      bm: `Anda berhenti di langkah ${n} daripada ${m}. Teruskan dari tempat anda berhenti?`,
    }),
  },
  finishDelivery: {
    emoji: '🎉',
    title: { en: "You're all set!", bm: 'Semua sudah sedia!' },
    body: {
      en: 'Your first task: sign for your first delivery of stock from Xocks.',
      bm: 'Tugasan pertama anda: tandatangan penghantaran stok pertama anda daripada Xocks.',
    },
  },
  finish: {
    emoji: '🎉',
    title: { en: "You're all set!", bm: 'Semua sudah sedia!' },
    body: {
      en: 'You can replay this tour any time from Tutorial Guide on Home.',
      bm: 'Anda boleh ulang lawatan ini bila-bila masa dari Tutorial Guide di Home.',
    },
  },
  buttons: {
    start: { en: 'Start the tour', bm: 'Mula lawatan' },
    maybeLater: { en: 'Maybe later', bm: 'Nanti dulu' },
    noThanks: { en: 'No thanks', bm: 'Tidak perlu' },
    continue: { en: 'Continue tour', bm: 'Teruskan lawatan' },
    notNow: { en: 'Not now', bm: 'Bukan sekarang' },
    skip: { en: 'Skip', bm: 'Langkau' },
    back: { en: 'Back', bm: 'Kembali' },
    next: { en: 'Next', bm: 'Seterusnya' },
    finish: { en: 'Finish', bm: 'Tamat' },
    goDelivery: { en: 'Go to my delivery', bm: 'Pergi ke penghantaran saya' },
    done: { en: 'Done', bm: 'Selesai' },
  },
  of: { en: 'of', bm: 'daripada' },
} as const

export const pick = (text: Bilingual, lang: Lang) => text[lang]
