import type { Metadata } from 'next'
import './globals.css'

import { ThemeProvider } from '@/components/theme-provider'
import { Sidebar } from '@/components/layout/sidebar'

export const metadata: Metadata = {
  title: 'Quimibond Intelligence',
  description: 'Sistema de inteligencia comercial para Quimibond',
}

export default function RootLayout({
  children,
}: {
  children: React.ReactNode
}) {
  return (
    <html lang="es" suppressHydrationWarning>
      <body className="antialiased">
        <ThemeProvider defaultTheme="light">
          <Sidebar />
          <main className="pl-[260px]">{children}</main>
        </ThemeProvider>
      </body>
    </html>
  )
}
