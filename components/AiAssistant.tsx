'use client'

import { useState, useRef, useEffect } from 'react'
import { Sparkles, X, Send, Loader2, ChevronDown } from 'lucide-react'
import { cn } from '@/lib/utils'

interface Message {
  role: 'user' | 'assistant'
  content: string
  toolCalls?: string[]
}

const SUGGESTIONS = [
  'Create a DO to Ali Gunting KL with 10 ankle socks',
  'Show me all pending restock requests',
  'What are my dashboard stats?',
  'List all active stores',
]

const TOOL_LABELS: Record<string, string> = {
  list_stores: '🏪 Looking up stores…',
  list_products: '📦 Searching products…',
  create_delivery_order: '📋 Creating delivery order…',
  get_store_inventory: '📊 Checking inventory…',
  list_delivery_orders: '🚚 Fetching delivery orders…',
  get_dashboard_stats: '📈 Loading stats…',
  list_restock_requests: '🔄 Checking restock queue…',
}

export default function AiAssistant() {
  const [open, setOpen] = useState(false)
  const [messages, setMessages] = useState<Message[]>([])
  const [input, setInput] = useState('')
  const [loading, setLoading] = useState(false)
  const [activeTool, setActiveTool] = useState<string | null>(null)
  const bottomRef = useRef<HTMLDivElement>(null)
  const inputRef = useRef<HTMLTextAreaElement>(null)

  useEffect(() => {
    if (open) setTimeout(() => inputRef.current?.focus(), 100)
  }, [open])

  useEffect(() => {
    bottomRef.current?.scrollIntoView({ behavior: 'smooth' })
  }, [messages, activeTool])

  async function sendMessage(text?: string) {
    const userText = (text ?? input).trim()
    if (!userText || loading) return
    setInput('')

    const userMsg: Message = { role: 'user', content: userText }
    const newMessages = [...messages, userMsg]
    setMessages(newMessages)
    setLoading(true)
    setActiveTool(null)

    // Convert to Anthropic format (merge consecutive same-role)
    const apiMessages = newMessages.map(m => ({ role: m.role, content: m.content }))

    try {
      const res = await fetch('/api/ai/chat', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ messages: apiMessages }),
      })

      if (!res.ok) throw new Error('Request failed')

      const reader = res.body!.getReader()
      const decoder = new TextDecoder()
      let assistantText = ''
      const toolCalls: string[] = []

      while (true) {
        const { done, value } = await reader.read()
        if (done) break
        const chunk = decoder.decode(value)
        for (const line of chunk.split('\n')) {
          if (!line.startsWith('data: ')) continue
          try {
            const event = JSON.parse(line.slice(6))
            if (event.type === 'text') {
              assistantText += event.text
              setMessages(prev => {
                const updated = [...prev]
                const last = updated[updated.length - 1]
                if (last?.role === 'assistant') {
                  updated[updated.length - 1] = { ...last, content: assistantText, toolCalls }
                } else {
                  updated.push({ role: 'assistant', content: assistantText, toolCalls })
                }
                return updated
              })
            } else if (event.type === 'tool_call') {
              toolCalls.push(event.tool)
              setActiveTool(event.tool)
            } else if (event.type === 'done') {
              setActiveTool(null)
            } else if (event.type === 'error') {
              const isBillingError = event.message?.toLowerCase().includes('credit balance') || event.message?.toLowerCase().includes('billing') || event.message?.toLowerCase().includes('upgrade')
              const isAuthError = !isBillingError && (event.message?.toLowerCase().includes('invalid') && event.message?.toLowerCase().includes('key') || event.message?.toLowerCase().includes('authentication'))
              const friendly = isBillingError
                ? '⚠️ Anthropic account has no credit.\n\nGo to console.anthropic.com → Settings → Billing to add funds, then try again.'
                : isAuthError
                ? '⚠️ Invalid Anthropic API key. Check ANTHROPIC_API_KEY in .env.local.'
                : `⚠️ ${event.message}`
              setMessages(prev => [...prev, { role: 'assistant', content: friendly }])
              setActiveTool(null)
            }
          } catch { /* skip malformed */ }
        }
      }
    } catch (e) {
      setMessages(prev => [...prev, { role: 'assistant', content: '⚠️ ' + (e instanceof Error ? e.message : 'Something went wrong') }])
    } finally {
      setLoading(false)
      setActiveTool(null)
    }
  }

  function handleKeyDown(e: React.KeyboardEvent) {
    if (e.key === 'Enter' && !e.shiftKey) { e.preventDefault(); sendMessage() }
  }

  return (
    <>
      {/* Floating button */}
      <button
        onClick={() => setOpen(o => !o)}
        className={cn(
          'fixed bottom-6 right-6 z-50 w-14 h-14 rounded-full shadow-xl flex items-center justify-center transition-all',
          open ? 'bg-gray-800 rotate-0' : 'bg-[#0A0A0A] hover:scale-105'
        )}
      >
        {open
          ? <ChevronDown size={22} className="text-white" />
          : <Sparkles size={22} className="text-[#FFD700]" />
        }
      </button>

      {/* Chat panel */}
      {open && (
        <div className="fixed bottom-24 right-6 z-50 w-[420px] max-w-[calc(100vw-24px)] bg-white rounded-2xl shadow-2xl border border-gray-100 flex flex-col overflow-hidden" style={{ height: '560px' }}>
          {/* Header */}
          <div className="bg-[#0A0A0A] px-5 py-4 flex items-center justify-between flex-shrink-0">
            <div className="flex items-center gap-2.5">
              <Sparkles size={18} className="text-[#FFD700]" />
              <div>
                <p className="text-white font-semibold text-sm">XCMS Assistant</p>
                <p className="text-white/40 text-xs">Ask me to do anything</p>
              </div>
            </div>
            <button onClick={() => setOpen(false)} className="text-white/40 hover:text-white transition-colors">
              <X size={18} />
            </button>
          </div>

          {/* Messages */}
          <div className="flex-1 overflow-y-auto p-4 space-y-4">
            {messages.length === 0 && (
              <div className="space-y-3">
                <p className="text-xs text-gray-400 text-center pt-2">Try asking me:</p>
                {SUGGESTIONS.map(s => (
                  <button
                    key={s}
                    onClick={() => sendMessage(s)}
                    className="w-full text-left text-sm px-4 py-3 rounded-xl border border-gray-100 hover:border-[#FFD700] hover:bg-yellow-50 transition-colors text-gray-600"
                  >
                    {s}
                  </button>
                ))}
              </div>
            )}

            {messages.map((msg, i) => (
              <div key={i} className={cn('flex', msg.role === 'user' ? 'justify-end' : 'justify-start')}>
                <div className={cn(
                  'max-w-[85%] rounded-2xl px-4 py-3 text-sm',
                  msg.role === 'user'
                    ? 'bg-[#0A0A0A] text-white rounded-br-sm'
                    : 'bg-gray-50 text-gray-800 rounded-bl-sm'
                )}>
                  {msg.toolCalls && msg.toolCalls.length > 0 && (
                    <div className="flex flex-wrap gap-1 mb-2">
                      {[...new Set(msg.toolCalls)].map(t => (
                        <span key={t} className="text-[10px] bg-[#FFD700]/20 text-yellow-700 px-2 py-0.5 rounded-full font-medium">
                          {t.replace(/_/g, ' ')}
                        </span>
                      ))}
                    </div>
                  )}
                  <p className="whitespace-pre-wrap leading-relaxed">{msg.content}</p>
                </div>
              </div>
            ))}

            {activeTool && (
              <div className="flex justify-start">
                <div className="bg-gray-50 rounded-2xl rounded-bl-sm px-4 py-3 text-sm text-gray-500 flex items-center gap-2">
                  <Loader2 size={14} className="animate-spin text-[#FFD700]" />
                  {TOOL_LABELS[activeTool] ?? `Running ${activeTool}…`}
                </div>
              </div>
            )}

            <div ref={bottomRef} />
          </div>

          {/* Input */}
          <div className="border-t border-gray-100 p-3 flex-shrink-0">
            <div className="flex items-end gap-2">
              <textarea
                ref={inputRef}
                value={input}
                onChange={e => setInput(e.target.value)}
                onKeyDown={handleKeyDown}
                placeholder="Ask me to create a DO, check inventory…"
                className="flex-1 resize-none rounded-xl border border-gray-200 px-4 py-3 text-sm focus:outline-none focus:border-[#0A0A0A] transition-colors max-h-32"
                rows={1}
                style={{ minHeight: '44px' }}
                disabled={loading}
              />
              <button
                onClick={() => sendMessage()}
                disabled={!input.trim() || loading}
                className="w-10 h-10 rounded-xl bg-[#0A0A0A] flex items-center justify-center disabled:opacity-30 hover:bg-gray-800 transition-colors flex-shrink-0"
              >
                {loading ? <Loader2 size={16} className="text-white animate-spin" /> : <Send size={16} className="text-[#FFD700]" />}
              </button>
            </div>
            <p className="text-[10px] text-gray-300 mt-1.5 text-center">Enter to send · Shift+Enter for new line</p>
          </div>
        </div>
      )}
    </>
  )
}
