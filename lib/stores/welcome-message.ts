// The welcome message sent to a new store owner with their login details.
// Shared by Add Store (app/(admin)/admin/stores/new) and the store page's
// "Reset password & resend login" box, so both send the same text.
// Client-safe: no server imports.

export interface WelcomeMessageInput {
  /** PIC name; falls back to "there" when blank or missing. */
  picName?: string | null
  /** Store name; falls back to "your store" when blank or missing. */
  storeName?: string | null
  /** Login page URL, e.g. https://…/login */
  loginUrl: string
  /** Login email for the store owner account. */
  email: string
  /** Temporary password. Only ever held in component state, never stored. */
  password: string
}

export function buildWelcomeMessage({ picName, storeName, loginUrl, email, password }: WelcomeMessageInput): string {
  const store = storeName || 'your store'
  return `Hi ${picName ?? 'there'}! 👋

Welcome to Xocks. Here are your login details for ${store}:

🔗 Login link: ${loginUrl}
📧 Email: ${email}
🔑 Temporary password: ${password}

For security, please change your password after first login:
1. Log in with the password above
2. Tap the Account tab at the bottom
3. Tap "Change Password"
4. Set a strong password you'll remember

Need help? Check the tutorial guide in the Account tab.

Welcome aboard! 🧦`
}

/**
 * wa.me link for a Malaysian PIC phone. Strips non-digits and turns a leading
 * 0 into 60, so "012-345 6789" opens chat with 60123456789.
 */
export function whatsappUrl(phone: string | null | undefined, text: string): string {
  const digits = (phone ?? '').replace(/\D/g, '')
  const intl = digits.startsWith('0') ? '60' + digits.slice(1) : digits
  return `https://wa.me/${intl}?text=${encodeURIComponent(text)}`
}
