'use client'

import * as React from 'react'
import Link from 'next/link'
import { usePathname } from 'next/navigation'
import {
  LayoutDashboard,
  AlertCircle,
  MessageSquare,
  CheckSquare2,
  Users,
  BookOpen,
  Moon,
  Sun,
} from 'lucide-react'

import { cn } from '@/lib/utils'
import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import { useTheme } from '@/components/theme-provider'
import { supabase } from '@/lib/supabase'

interface NavItem {
  label: string
  href: string
  icon: React.ReactNode
  badgeKey?: string
}

const navItems: NavItem[] = [
  {
    label: 'Dashboard',
    href: '/dashboard',
    icon: <LayoutDashboard className="w-5 h-5" />,
  },
  {
    label: 'Alertas',
    href: '/alerts',
    icon: <AlertCircle className="w-5 h-5" />,
    badgeKey: 'alerts',
  },
  {
    label: 'Chat',
    href: '/chat',
    icon: <MessageSquare className="w-5 h-5" />,
  },
  {
    label: 'Acciones',
    href: '/actions',
    icon: <CheckSquare2 className="w-5 h-5" />,
    badgeKey: 'actions',
  },
  {
    label: 'Contactos',
    href: '/contacts',
    icon: <Users className="w-5 h-5" />,
  },
  {
    label: 'Briefings',
    href: '/briefings',
    icon: <BookOpen className="w-5 h-5" />,
  },
]

export function Sidebar() {
  const pathname = usePathname()
  const { theme, toggleTheme } = useTheme()
  const [badgeCounts, setBadgeCounts] = React.useState<
    Record<string, number>
  >({})
  const [mounted, setMounted] = React.useState(false)

  React.useEffect(() => {
    setMounted(true)
    fetchBadgeCounts()

    // Refresh badge counts every 60 seconds
    const interval = setInterval(fetchBadgeCounts, 60000)
    return () => clearInterval(interval)
  }, [])

  const fetchBadgeCounts = async () => {
    try {
      // Fetch new alerts count
      const { count: alertsCount } = await supabase
        .from('alerts')
        .select('id', { count: 'exact', head: true })
        .eq('state', 'new')

      // Fetch pending actions count
      const { count: actionsCount } = await supabase
        .from('action_items')
        .select('id', { count: 'exact', head: true })
        .eq('state', 'pending')

      setBadgeCounts({
        alerts: alertsCount || 0,
        actions: actionsCount || 0,
      })
    } catch (error) {
      console.error('Failed to fetch badge counts:', error)
    }
  }

  if (!mounted) {
    return null
  }

  return (
    <aside className="fixed left-0 top-0 z-40 h-screen w-[260px] border-r border-border bg-card flex flex-col">
      {/* Logo Area */}
      <div className="flex items-center gap-2 px-6 py-8 border-b border-border">
        <div className="flex flex-col gap-0.5">
          <div className="text-lg font-bold tracking-tight text-foreground">
            QUIMIBOND
          </div>
          <div className="text-xs font-medium text-muted-foreground">
            Intelligence
          </div>
        </div>
      </div>

      {/* Navigation */}
      <nav className="flex-1 px-4 py-6 space-y-1">
        {navItems.map((item) => {
          const isActive = pathname.startsWith(item.href)
          const badgeCount = item.badgeKey ? badgeCounts[item.badgeKey] : 0

          return (
            <Link key={item.href} href={item.href}>
              <button
                className={cn(
                  'w-full flex items-center gap-3 px-4 py-2.5 rounded-md text-sm font-medium transition-colors',
                  isActive
                    ? 'bg-primary/10 text-primary'
                    : 'text-muted-foreground hover:text-foreground hover:bg-accent'
                )}
              >
                <span className="flex-shrink-0">{item.icon}</span>
                <span className="flex-1 text-left">{item.label}</span>
                {badgeCount > 0 && (
                  <Badge
                    variant="critical"
                    className="text-xs font-semibold px-1.5 py-0.5 min-w-max"
                  >
                    {badgeCount}
                  </Badge>
                )}
              </button>
            </Link>
          )
        })}
      </nav>

      {/* Footer - Theme Toggle */}
      <div className="px-4 py-6 border-t border-border">
        <Button
          variant="outline"
          size="sm"
          onClick={toggleTheme}
          className="w-full flex items-center gap-2"
        >
          {theme === 'light' ? (
            <>
              <Moon className="w-4 h-4" />
              <span>Oscuro</span>
            </>
          ) : (
            <>
              <Sun className="w-4 h-4" />
              <span>Claro</span>
            </>
          )}
        </Button>
      </div>
    </aside>
  )
}
