'use client'

import * as React from 'react'

type Theme = 'light' | 'dark'

interface ThemeContextType {
  theme: Theme
  setTheme: (theme: Theme) => void
  toggleTheme: () => void
}

const ThemeContext = React.createContext<ThemeContextType | undefined>(
  undefined
)

export function useTheme() {
  const context = React.useContext(ThemeContext)
  if (!context) {
    throw new Error('useTheme must be used within a ThemeProvider')
  }
  return context
}

interface ThemeProviderProps {
  children: React.ReactNode
  defaultTheme?: Theme
}

export function ThemeProvider({
  children,
  defaultTheme = 'light',
}: ThemeProviderProps) {
  const [theme, setThemeState] = React.useState<Theme>(defaultTheme)
  const [mounted, setMounted] = React.useState(false)

  React.useEffect(() => {
    setMounted(true)

    // Read from cookie on mount
    const cookieTheme = document.cookie
      .split('; ')
      .find((row) => row.startsWith('theme='))
      ?.split('=')[1] as Theme | undefined

    if (cookieTheme) {
      setThemeState(cookieTheme)
      applyTheme(cookieTheme)
    } else {
      // Check system preference
      const prefersDark = window.matchMedia(
        '(prefers-color-scheme: dark)'
      ).matches
      const initialTheme: Theme = prefersDark ? 'dark' : 'light'
      setThemeState(initialTheme)
      applyTheme(initialTheme)
    }
  }, [])

  const applyTheme = (newTheme: Theme) => {
    const html = document.documentElement
    if (newTheme === 'dark') {
      html.classList.add('dark')
    } else {
      html.classList.remove('dark')
    }
  }

  const setTheme = (newTheme: Theme) => {
    setThemeState(newTheme)
    applyTheme(newTheme)

    // Store in cookie
    document.cookie = `theme=${newTheme}; path=/; max-age=31536000`
  }

  const toggleTheme = () => {
    setTheme(theme === 'light' ? 'dark' : 'light')
  }

  return (
    <ThemeContext.Provider value={{ theme, setTheme, toggleTheme }}>
      {children}
    </ThemeContext.Provider>
  )
}
