// Bank account printed on commission invoices. Edited in Settings → Company Info.
// An empty field on the invoice falls back to the value in BANK_DEFAULTS.

export const BANK_SETTING_KEYS = {
  bankName: 'company_bank_name',
  accountName: 'company_bank_account_name',
  accountNo: 'company_bank_account_no',
} as const

export const BANK_DEFAULTS = {
  bankName: 'CIMB Bank',
  accountName: 'Wayne Group Holding Sdn Bhd',
  accountNo: '8605806682',
} as const

export interface BankDetails {
  bankName?: string
  accountName?: string
  accountNo?: string
}
