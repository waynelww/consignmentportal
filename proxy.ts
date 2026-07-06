import { createServerClient } from '@supabase/ssr'
import { NextResponse, type NextRequest } from 'next/server'

// Shared-credentials Basic Auth gate. Used for tools we want to share with
// the team (and external partners) without giving them an XCMS account.
function basicAuthGate(request: NextRequest, realm: string, userEnv: string, passEnv: string) {
  const expectedUser = process.env[userEnv]
  const expectedPass = process.env[passEnv]
  if (!expectedUser || !expectedPass) {
    return new NextResponse(`${realm} is not configured. Set ${userEnv} and ${passEnv} env vars.`, { status: 503 })
  }
  const header = request.headers.get('authorization') || ''
  const expected = `Basic ${btoa(`${expectedUser}:${expectedPass}`)}`
  if (header !== expected) {
    return new NextResponse('Authentication required', {
      status: 401,
      headers: { 'WWW-Authenticate': `Basic realm="${realm}"` },
    })
  }
  return null
}

export async function proxy(request: NextRequest) {
  const path = request.nextUrl.pathname

  // Public tools gated by shared credentials (no XCMS account required).
  if (path === '/oem-calculator.html') {
    const denied = basicAuthGate(request, 'OEM Calculator', 'CALC_USER', 'CALC_PASS')
    if (denied) return denied
    return NextResponse.next()
  }

  let supabaseResponse = NextResponse.next({ request })

  const supabase = createServerClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!,
    {
      cookies: {
        getAll() {
          return request.cookies.getAll()
        },
        setAll(cookiesToSet) {
          cookiesToSet.forEach(({ name, value }) => request.cookies.set(name, value))
          supabaseResponse = NextResponse.next({ request })
          cookiesToSet.forEach(({ name, value, options }) =>
            supabaseResponse.cookies.set(name, value, options)
          )
        },
      },
    }
  )

  // Every /api route carries its own auth: session routes call getUser()
  // themselves, cron uses CRON_SECRET, bot uses BOT_API_KEY, and
  // check-rate-limit is deliberately public. Skipping the gate here removes
  // a duplicate Supabase Auth round-trip from every API call.
  // (This also keeps cron/bot working — they run with no session cookie and
  // would otherwise be 307-redirected to /login.)
  if (path.startsWith('/api/')) {
    return supabaseResponse
  }

  const { data: { user } } = await supabase.auth.getUser()

  const isAuthPage = path.startsWith('/login')
  const isAdminPage = path.startsWith('/admin')
  const isStorePage = path.startsWith('/store')

  if (!user && !isAuthPage) {
    return NextResponse.redirect(new URL('/login', request.url))
  }

  // Role lookup with cookie cache — saves a DB query on every page
  // navigation. The cookie is bound to the user id so a different account
  // logging in on the same browser never reads a stale role. Tampering only
  // affects redirect routing; all data access is enforced by RLS + API auth.
  const ROLE_COOKIE = 'xcms-role'

  async function getRole(): Promise<string | null> {
    if (!user) return null
    const cached = request.cookies.get(ROLE_COOKIE)?.value
    if (cached) {
      const [uid, role] = cached.split(':')
      if (uid === user.id && role) return role
    }
    const { data: profile } = await supabase
      .from('profiles')
      .select('role')
      .eq('id', user.id)
      .single()
    if (profile?.role) {
      supabaseResponse.cookies.set(ROLE_COOKIE, `${user.id}:${profile.role}`, {
        httpOnly: true,
        sameSite: 'lax',
        path: '/',
        maxAge: 60 * 60 * 24, // 24h — re-validates daily in case a role changes
      })
    }
    return profile?.role ?? null
  }

  if (user && isAuthPage) {
    const role = await getRole()
    const dest = role === 'store_owner' ? '/store/dashboard' : '/admin/dashboard'
    return NextResponse.redirect(new URL(dest, request.url))
  }

  if (user && isAdminPage) {
    if ((await getRole()) === 'store_owner') {
      return NextResponse.redirect(new URL('/store/dashboard', request.url))
    }
  }

  if (user && isStorePage) {
    if ((await getRole()) !== 'store_owner') {
      return NextResponse.redirect(new URL('/admin/dashboard', request.url))
    }
  }

  return supabaseResponse
}

export const config = {
  matcher: ['/((?!_next/static|_next/image|favicon.ico|manifest.json|icon-).*)'],
}
