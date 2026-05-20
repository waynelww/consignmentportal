import { createClient } from '@supabase/supabase-js'
import * as dotenv from 'dotenv'

dotenv.config({ path: '.env.local' })

const supabase = createClient(
  process.env.NEXT_PUBLIC_SUPABASE_URL!,
  process.env.SUPABASE_SERVICE_ROLE_KEY!
)

// ── Types ────────────────────────────────────────────────────────────────────

interface SeedUser {
  email: string
  password: string
  full_name: string
  phone: string
  role: 'super_admin' | 'ops_manager' | 'store_owner'
}

interface SeedProduct {
  sku: string
  name: string
  category: string
  color: string
  selling_price: number
  cost_price: number
  is_core_sku: boolean
}

// ── Data ─────────────────────────────────────────────────────────────────────

const USERS: SeedUser[] = [
  {
    email: 'wayne@xocks.co',
    password: 'Xocks@Admin2024!',
    full_name: 'Wayne',
    phone: '',
    role: 'super_admin',
  },
  {
    email: 'roshaan@xocks.co',
    password: 'Xocks@Ops2024!',
    full_name: 'Roshaan',
    phone: '',
    role: 'ops_manager',
  },
]

const PRODUCTS: SeedProduct[] = [
  {
    sku: 'BLK-ANK',
    name: 'Black Ankle Socks',
    category: 'ankle',
    color: 'Black',
    selling_price: 13.99,
    cost_price: 4.20,
    is_core_sku: true,
  },
  {
    sku: 'WHT-ANK',
    name: 'White Ankle Socks',
    category: 'ankle',
    color: 'White',
    selling_price: 13.99,
    cost_price: 4.20,
    is_core_sku: true,
  },
  {
    sku: 'BLK-CREW',
    name: 'Black Crew Socks',
    category: 'crew',
    color: 'Black',
    selling_price: 13.99,
    cost_price: 4.20,
    is_core_sku: true,
  },
  {
    sku: 'WHT-CREW',
    name: 'White Crew Socks',
    category: 'crew',
    color: 'White',
    selling_price: 13.99,
    cost_price: 4.20,
    is_core_sku: true,
  },
  {
    sku: 'GRY-CREW',
    name: 'Grey Crew Socks',
    category: 'crew',
    color: 'Grey',
    selling_price: 13.99,
    cost_price: 4.20,
    is_core_sku: true,
  },
  {
    sku: 'BLK-NOSH',
    name: 'Black No Show Socks',
    category: 'no_show',
    color: 'Black',
    selling_price: 13.99,
    cost_price: 4.20,
    is_core_sku: true,
  },
  {
    sku: 'WHT-NOSH',
    name: 'White No Show Socks',
    category: 'no_show',
    color: 'White',
    selling_price: 13.99,
    cost_price: 4.20,
    is_core_sku: true,
  },
]

// ── Helpers ──────────────────────────────────────────────────────────────────

async function seedUser(user: SeedUser): Promise<string | null> {
  console.log(`\n→ Creating user: ${user.email} (${user.role})`)

  const { data, error } = await supabase.auth.admin.createUser({
    email: user.email,
    password: user.password,
    email_confirm: true,
  })

  if (error) {
    if (error.message?.includes('already been registered')) {
      console.log(`  ⚠  User ${user.email} already exists — skipping auth creation.`)
      // Try to fetch existing user
      const { data: listData, error: listError } = await supabase.auth.admin.listUsers()
      if (listError) {
        console.error(`  ✗  Could not fetch user list:`, listError.message)
        return null
      }
      const existing = listData.users.find((u) => u.email === user.email)
      return existing?.id ?? null
    }
    console.error(`  ✗  Failed to create auth user ${user.email}:`, error.message)
    return null
  }

  const userId = data.user.id
  console.log(`  ✓  Auth user created: ${userId}`)

  // Insert profile
  const { error: profileError } = await supabase.from('profiles').upsert(
    {
      id: userId,
      full_name: user.full_name,
      phone: user.phone || null,
      role: user.role,
      store_id: null,
    },
    { onConflict: 'id' }
  )

  if (profileError) {
    console.error(`  ✗  Failed to insert profile for ${user.email}:`, profileError.message)
  } else {
    console.log(`  ✓  Profile inserted: ${user.full_name} (${user.role})`)
  }

  return userId
}

async function seedProducts(): Promise<void> {
  console.log('\n→ Seeding products...')

  for (const product of PRODUCTS) {
    const { error } = await supabase.from('products').upsert(product, {
      onConflict: 'sku',
    })

    if (error) {
      console.error(`  ✗  Failed to upsert product ${product.sku}:`, error.message)
    } else {
      console.log(`  ✓  Product upserted: ${product.sku} — ${product.name}`)
    }
  }
}

// ── Main ─────────────────────────────────────────────────────────────────────

async function main(): Promise<void> {
  console.log('═══════════════════════════════════════════')
  console.log('  XCMS Seed Script')
  console.log('═══════════════════════════════════════════')

  if (!process.env.NEXT_PUBLIC_SUPABASE_URL || !process.env.SUPABASE_SERVICE_ROLE_KEY) {
    console.error('\n✗  Missing env vars: NEXT_PUBLIC_SUPABASE_URL or SUPABASE_SERVICE_ROLE_KEY')
    console.error('   Make sure .env.local is present and correct.')
    process.exit(1)
  }

  console.log(`\nConnecting to: ${process.env.NEXT_PUBLIC_SUPABASE_URL}`)

  // 1. Seed users
  for (const user of USERS) {
    await seedUser(user)
  }

  // 2. Seed products
  await seedProducts()

  console.log('\n═══════════════════════════════════════════')
  console.log('  Seed complete.')
  console.log('═══════════════════════════════════════════\n')
}

main().catch((err) => {
  console.error('\nUnexpected error during seed:', err)
  process.exit(1)
})
