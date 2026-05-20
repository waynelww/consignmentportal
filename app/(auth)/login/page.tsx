'use client'

import { useState } from 'react'
import { useForm } from 'react-hook-form'
import { zodResolver } from '@hookform/resolvers/zod'
import { z } from 'zod'
import { useRouter } from 'next/navigation'
import { Eye, EyeOff, Loader2 } from 'lucide-react'
import { toast } from 'sonner'
import { createClient } from '@/lib/supabase/client'
import { cn } from '@/lib/utils'

const loginSchema = z.object({
  email: z.string().email('Enter a valid email address'),
  password: z.string().min(6, 'Password must be at least 6 characters'),
})

type LoginFormValues = z.infer<typeof loginSchema>

export default function LoginPage() {
  const router = useRouter()
  const [showPassword, setShowPassword] = useState(false)
  const [isResetting, setIsResetting] = useState(false)

  const {
    register,
    handleSubmit,
    getValues,
    formState: { errors, isSubmitting },
  } = useForm<LoginFormValues>({
    resolver: zodResolver(loginSchema),
  })

  async function onSubmit(values: LoginFormValues) {
    const supabase = createClient()
    const { error } = await supabase.auth.signInWithPassword({
      email: values.email,
      password: values.password,
    })

    if (error) {
      toast.error('Invalid email or password')
      return
    }

    const { data: { user } } = await supabase.auth.getUser()
    if (!user) {
      toast.error('Authentication failed. Please try again.')
      return
    }

    const { data: profile } = await supabase
      .from('profiles')
      .select('role')
      .eq('id', user.id)
      .single()

    if (profile?.role === 'store_owner') {
      router.push('/store/dashboard')
    } else {
      router.push('/admin/dashboard')
    }
  }

  async function handleForgotPassword() {
    const email = getValues('email')
    if (!email) {
      toast.error('Enter your email address first')
      return
    }

    setIsResetting(true)
    const supabase = createClient()
    const { error } = await supabase.auth.resetPasswordForEmail(email, {
      redirectTo: `${window.location.origin}/auth/reset-password`,
    })
    setIsResetting(false)

    if (error) {
      toast.error('Could not send reset email. Please try again.')
    } else {
      toast.success('Password reset email sent. Check your inbox.')
    }
  }

  return (
    <div className="w-full max-w-[400px]">
      <div className="bg-white rounded-xl shadow-sm px-8 py-10">
        {/* Logo / Brand */}
        <div className="text-center mb-8">
          <h1 className="text-4xl font-bold tracking-tight text-[#0A0A0A]">XOCKS</h1>
          <p className="mt-2 text-sm text-gray-500">Consignment Partner Portal</p>
        </div>

        {/* Form */}
        <form onSubmit={handleSubmit(onSubmit)} noValidate className="space-y-4">
          {/* Email */}
          <div>
            <label className="block text-sm font-medium text-gray-700 mb-1">
              Email Address
            </label>
            <input
              type="email"
              autoComplete="email"
              {...register('email')}
              className={cn(
                'w-full h-12 px-4 rounded-xl border bg-white text-[#0A0A0A] text-sm',
                'focus:outline-none focus:ring-2 focus:ring-[#FFD700] focus:border-transparent',
                'placeholder:text-gray-400 transition-all',
                errors.email ? 'border-red-400' : 'border-gray-200',
              )}
              placeholder="you@example.com"
            />
            {errors.email && (
              <p className="mt-1 text-xs text-red-500">{errors.email.message}</p>
            )}
          </div>

          {/* Password */}
          <div>
            <label className="block text-sm font-medium text-gray-700 mb-1">
              Password
            </label>
            <div className="relative">
              <input
                type={showPassword ? 'text' : 'password'}
                autoComplete="current-password"
                {...register('password')}
                className={cn(
                  'w-full h-12 px-4 pr-12 rounded-xl border bg-white text-[#0A0A0A] text-sm',
                  'focus:outline-none focus:ring-2 focus:ring-[#FFD700] focus:border-transparent',
                  'placeholder:text-gray-400 transition-all',
                  errors.password ? 'border-red-400' : 'border-gray-200',
                )}
                placeholder="••••••••"
              />
              <button
                type="button"
                onClick={() => setShowPassword((v) => !v)}
                className="absolute right-3 top-1/2 -translate-y-1/2 text-gray-400 hover:text-gray-600 transition-colors"
                tabIndex={-1}
              >
                {showPassword ? <EyeOff size={18} /> : <Eye size={18} />}
              </button>
            </div>
            {errors.password && (
              <p className="mt-1 text-xs text-red-500">{errors.password.message}</p>
            )}
          </div>

          {/* Submit */}
          <button
            type="submit"
            disabled={isSubmitting}
            className={cn(
              'w-full h-14 rounded-xl bg-[#0A0A0A] text-[#FFD700] font-semibold text-base',
              'flex items-center justify-center gap-2 transition-opacity',
              isSubmitting ? 'opacity-60 cursor-not-allowed' : 'hover:opacity-90 active:opacity-80',
            )}
          >
            {isSubmitting ? (
              <>
                <Loader2 size={18} className="animate-spin" />
                Signing in…
              </>
            ) : (
              'Sign In'
            )}
          </button>
        </form>

        {/* Forgot password */}
        <div className="mt-4 text-center">
          <button
            type="button"
            onClick={handleForgotPassword}
            disabled={isResetting}
            className="text-sm text-gray-500 hover:text-[#0A0A0A] underline underline-offset-2 transition-colors disabled:opacity-50"
          >
            {isResetting ? 'Sending…' : 'Forgot password?'}
          </button>
        </div>
      </div>

      {/* Footer */}
      <p className="mt-6 text-center text-xs text-gray-400">
        © Xocks by Wayne Group Holding
      </p>
    </div>
  )
}
