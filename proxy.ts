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

  // Bot API endpoints use their own API key auth — skip Supabase session check.
  if (path.startsWith('/api/bot')) {
    return supabaseResponse
  }

  // Cron endpoints authenticate with the CRON_SECRET bearer token (checked
  // inside each route). They run with no session cookie, so without this
  // exclusion the gate below 307-redirects them to /login and the handlers
  // never execute — which is exactly how the 1 June invoice run was lost.
  if (path.startsWith('/api/cron')) {
    return supabaseResponse
  }

  const { data: { user } } = await supabase.auth.getUser()

  const isAuthPage = path.startsWith('/login')
  const isAdminPage = path.startsWith('/admin')
  const isStorePage = path.startsWith('/store')

  if (!user && !isAuthPage) {
    return NextResponse.redirect(new URL('/login', request.url))
  }

  if (user && isAuthPage) {
    const { data: profile } = await supabase
      .from('profiles')
      .select('role')
      .eq('id', user.id)
      .single()

    if (profile?.role === 'store_owner') {
      return NextResponse.redirect(new URL('/store/dashboard', request.url))
    } else {
      return NextResponse.redirect(new URL('/admin/dashboard', request.url))
    }
  }

  if (user && isAdminPage) {
    const { data: profile } = await supabase
      .from('profiles')
      .select('role')
      .eq('id', user.id)
      .single()

    if (profile?.role === 'store_owner') {
      return NextResponse.redirect(new URL('/store/dashboard', request.url))
    }
  }

  if (user && isStorePage) {
    const { data: profile } = await supabase
      .from('profiles')
      .select('role')
      .eq('id', user.id)
      .single()

    if (profile?.role !== 'store_owner') {
      return NextResponse.redirect(new URL('/admin/dashboard', request.url))
    }
  }

  return supabaseResponse
}

export const config = {
  matcher: ['/((?!_next/static|_next/image|favicon.ico|manifest.json|icon-).*)'],
}
