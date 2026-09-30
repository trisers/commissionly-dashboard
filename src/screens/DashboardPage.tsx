import { useEffect, useRef, useState } from 'react'
import { useLocation, useNavigate, useParams } from 'react-router-dom'
import {
  clearAuthSession,
  getOrdersTableData,
  getRepresentativeDetails,
  getRepresentativeProfile,
  isAuthError,
  logoutRepresentative,
  updateRepresentativeProfile,
} from '../api/repApi'
import type { OrderLineItem, OrdersSortBy, RepDashboardData } from '../api/repApi'
import { OrderDetailsView } from './OrderDetailsView'
import { ConfirmDialog } from '../components/ConfirmDialog'
import { Select } from '../components/Select'
import type { SelectOption } from '../components/Select'
import './dashboard.css'

// Same as the admin Orders table: show 2 items, then "+N more".
const MAX_VISIBLE_ITEMS = 2

// Orders table filters, matching the admin Orders page.
const ORDERS_PER_PAGE_OPTIONS = [10, 25, 50, 100]

type OrdersSort = { sortBy: OrdersSortBy; sortOrder: 'asc' | 'desc' }
type DatePreset = 'thisMonth' | 'last7' | 'last30' | 'custom'

const DATE_PRESET_OPTIONS: SelectOption<DatePreset>[] = [
  { value: 'thisMonth', label: 'This month' },
  { value: 'last7', label: 'Last 7 days' },
  { value: 'last30', label: 'Last 30 days' },
  { value: 'custom', label: 'Custom range' },
]

const ORDERS_COLUMNS: { label: string; sortBy?: OrdersSortBy }[] = [
  { label: 'Order ID', sortBy: 'orderId' },
  { label: 'Order Value', sortBy: 'orderValue' },
  { label: 'Commission %', sortBy: 'commissionPercent' },
  { label: 'Commission Earned', sortBy: 'commissionEarned' },
  // Status column hidden for now (UI only).
  // { label: 'Status', sortBy: 'status' },
  { label: 'Date', sortBy: 'date' },
  { label: 'Items' },
]

const toDateKeyUtc = (date: Date) => date.toISOString().slice(0, 10)

/** Same presets as the admin date range picker (UTC days). */
const getPresetRange = (preset: Exclude<DatePreset, 'custom'>) => {
  const now = new Date()
  const y = now.getUTCFullYear()
  const m = now.getUTCMonth()
  if (preset === 'thisMonth') {
    return {
      from: toDateKeyUtc(new Date(Date.UTC(y, m, 1))),
      to: toDateKeyUtc(new Date(Date.UTC(y, m + 1, 0))),
    }
  }
  const today = new Date(Date.UTC(y, m, now.getUTCDate()))
  const start = new Date(today)
  start.setUTCDate(start.getUTCDate() - (preset === 'last7' ? 6 : 29))
  return { from: toDateKeyUtc(start), to: toDateKeyUtc(today) }
}

// Small stroke icons for the Orders filter bar, table headers and pager.
const Icon = ({ path, size = 16 }: { path: string; size?: number }) => (
  <svg
    width={size}
    height={size}
    viewBox="0 0 24 24"
    fill="none"
    stroke="currentColor"
    strokeWidth="2"
    strokeLinecap="round"
    strokeLinejoin="round"
    aria-hidden="true"
  >
    <path d={path} />
  </svg>
)
const ICON_SEARCH = 'M11 19a8 8 0 1 0 0-16 8 8 0 0 0 0 16zM21 21l-4.35-4.35'
const ICON_CLOSE = 'M18 6 6 18M6 6l12 12'
const ICON_CALENDAR = 'M8 2v4M16 2v4M3 10h18M5 4h14a2 2 0 0 1 2 2v14a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2V6a2 2 0 0 1 2-2z'
const ICON_CHEVRON_LEFT = 'M15 18l-6-6 6-6'
const ICON_CHEVRON_RIGHT = 'M9 18l6-6-6-6'
const ICON_SORT = 'M7 15l5 5 5-5M7 9l5-5 5 5'
const ICON_SORT_ASC = 'M12 19V5M5 12l7-7 7 7'
const ICON_SORT_DESC = 'M12 5v14M19 12l-7 7-7-7'

/** "Hoodie (S / Black) × 2" */
const formatLineItem = (item: OrderLineItem) => {
  const variant =
    item.variantTitle && item.variantTitle !== 'Default Title' ? ` (${item.variantTitle})` : ''
  return `${item.title}${variant} × ${item.quantity}`
}

type ActiveTab = 'dashboard' | 'orders' | 'orderDetails' | 'profile'

const ORDER_DETAILS_PATH_PREFIX = '/dashboard/orders/'

const normalizeDashboardData = (input: unknown): RepDashboardData | null => {
  if (!input || typeof input !== 'object') return null

  const source = input as Partial<RepDashboardData>
  const representative = source.representative

  if (!representative || typeof representative !== 'object') return null

  return {
    representative: {
      id: representative.id ?? 0,
      name: representative.name ?? null,
      email: representative.email ?? '',
      staff_id: representative.staff_id ?? '',
      shop_url: representative.shop_url ?? '',
      status: representative.status ?? 'ACTIVE',
    },
    commissions: Array.isArray(source.commissions) ? source.commissions : [],
    metrics: {
      totalCommission: source.metrics?.totalCommission ?? 0,
      totalOrders: source.metrics?.totalOrders ?? 0,
    },
  }
}

const getDefaultDashboardData = (): RepDashboardData => ({
  representative: {
    id: 0,
    name: null,
    email: '',
    staff_id: '',
    shop_url: '',
    status: 'ACTIVE',
  },
  commissions: [],
  metrics: {
    totalCommission: 0,
    totalOrders: 0,
  },
})

export const DashboardPage = () => {
  const navigate = useNavigate()
  const location = useLocation()
  const { orderId: orderIdParam } = useParams()
  const [data, setData] = useState<RepDashboardData | null>(null)
  const [activeTab, setActiveTab] = useState<ActiveTab>('dashboard')
  const [showProfileDropdown, setShowProfileDropdown] = useState(false)
  const [showProfileEdit, setShowProfileEdit] = useState(false)
  const [isProfileEditing, setIsProfileEditing] = useState(false)
  const [editedName, setEditedName] = useState('')
  const [editedEmail, setEditedEmail] = useState('')
  const [isMobileMenuOpen, setIsMobileMenuOpen] = useState(false)
  const [showLogoutConfirm, setShowLogoutConfirm] = useState(false)
  const [isLoggingOut, setIsLoggingOut] = useState(false)
  const [ordersPage, setOrdersPage] = useState(1)
  const [ordersTotalCount, setOrdersTotalCount] = useState(0)
  const [ordersTotalPages, setOrdersTotalPages] = useState(1)
  const [isOrdersLoading, setIsOrdersLoading] = useState(false)
  const [ordersSearchInput, setOrdersSearchInput] = useState('')
  const [ordersSearch, setOrdersSearch] = useState('')
  const [ordersDatePreset, setOrdersDatePreset] = useState<DatePreset>('thisMonth')
  const [ordersFromDate, setOrdersFromDate] = useState(() => getPresetRange('thisMonth').from)
  const [ordersToDate, setOrdersToDate] = useState(() => getPresetRange('thisMonth').to)
  const [ordersSort, setOrdersSort] = useState<OrdersSort>({ sortBy: 'date', sortOrder: 'desc' })
  const [ordersPerPage, setOrdersPerPage] = useState(10)
  const [ordersError, setOrdersError] = useState<string | null>(null)
  // Bumped by "Retry" to refetch with the same filters.
  const [ordersReloadKey, setOrdersReloadKey] = useState(0)
  const [isDarkMode, setIsDarkMode] = useState(() => {
    const saved = localStorage.getItem('darkMode')
    return saved ? saved === 'true' : false
  })

  useEffect(() => {
    // Initialize dark mode on mount
    if (isDarkMode) {
      document.documentElement.classList.add('dark-mode')
    } else {
      document.documentElement.classList.remove('dark-mode')
    }
  }, [])

  useEffect(() => {
    if (location.pathname === '/dashboard/orders') {
      setActiveTab('orders')
      return
    }
    if (location.pathname.startsWith(ORDER_DETAILS_PATH_PREFIX)) {
      setActiveTab('orderDetails')
      return
    }
    if (location.pathname === '/dashboard/profile') {
      setActiveTab('profile')
      return
    }
    setActiveTab('dashboard')
  }, [location.pathname])

  // Opening Orders starts at page 1, except when coming back from an order's
  // details page: then keep the rep's page and filters.
  const previousTabRef = useRef<ActiveTab>(activeTab)
  useEffect(() => {
    const previousTab = previousTabRef.current
    previousTabRef.current = activeTab
    if (activeTab !== 'orders' || previousTab === 'orderDetails') return
    setOrdersPage(1)
  }, [activeTab])

  useEffect(() => {
    let isMounted = true

    const fetchLatestDetails = async () => {
      const storedData = localStorage.getItem('repData')
      let fallbackData: RepDashboardData | null = null

      if (storedData) {
        try {
          const parsed = normalizeDashboardData(JSON.parse(storedData))
          if (!parsed) {
            localStorage.removeItem('repData')
          } else {
            fallbackData = parsed
            if (isMounted) {
              setData(parsed)
              setEditedName(parsed.representative.name || '')
              setEditedEmail(parsed.representative.email || '')
            }
          }
        } catch {
          localStorage.removeItem('repData')
        }
      }

      try {
        // The Orders tab loads its own data. (Order details still loads the
        // summary below for the header/sidebar; OrderDetailsView loads the order.)
        if (location.pathname === '/dashboard/orders') {
          return
        }

        if (location.pathname === '/dashboard/profile') {
          const profileResponse = await getRepresentativeProfile()
          const baseData = fallbackData ?? getDefaultDashboardData()
          const profileData: RepDashboardData = {
            ...baseData,
            representative: {
              ...baseData.representative,
              id: profileResponse.representative.id,
              name: profileResponse.representative.name,
              email: profileResponse.representative.email,
              status: profileResponse.representative.status,
              shop_url: profileResponse.store.shop,
            },
          }

          if (!isMounted) return
          setData(profileData)
          setEditedName(profileData.representative.name || '')
          setEditedEmail(profileData.representative.email || '')
          localStorage.setItem('repData', JSON.stringify(profileData))
          return
        }

        const latestData = normalizeDashboardData(await getRepresentativeDetails())
        if (!latestData) {
          throw new Error('Invalid details payload')
        }
        if (!isMounted) return

        setData(latestData)
        setEditedName(latestData.representative.name || '')
        setEditedEmail(latestData.representative.email || '')
        localStorage.setItem('repData', JSON.stringify(latestData))
      } catch (error) {
        if (isAuthError(error)) {
          clearAuthSession()
          navigate('/')
          return
        }
        if (!fallbackData && isMounted) {
          navigate('/')
        }
      }
    }

    void fetchLatestDetails()

    return () => {
      isMounted = false
    }
  }, [location.pathname, navigate])

  useEffect(() => {
    let isMounted = true
    if (location.pathname !== '/dashboard/orders') return

    const fetchOrders = async () => {
      setIsOrdersLoading(true)
      try {
        const ordersResponse = await getOrdersTableData({
          filters: {
            search: ordersSearch || undefined,
            fromDate: ordersFromDate,
            toDate: ordersToDate,
            sortBy: ordersSort.sortBy,
            sortOrder: ordersSort.sortOrder,
          },
          pagination: {
            page: ordersPage,
            perPage: ordersPerPage,
          },
        })

        if (!isMounted) return

        const storedData = localStorage.getItem('repData')
        let currentData = getDefaultDashboardData()
        if (storedData) {
          try {
            currentData = normalizeDashboardData(JSON.parse(storedData)) ?? getDefaultDashboardData()
          } catch {
            currentData = getDefaultDashboardData()
          }
        }
        const mappedOrders = (ordersResponse.orders ?? []).map((order) => ({
          id: order.id,
          orderId: order.orderId,
          orderName: order.orderName,
          orderDetails: order.orderDetails ?? [],
          orderValue: order.orderValue,
          commissionValue: order.commissionValue,
          commission_type: order.commission_type,
          commission_earned: order.commission_earned,
          status: order.status,
          createdAt: order.createdAt,
        }))

        // Keep the overview metrics as they are: this list is filtered, so its
        // count/sum aren't the rep's totals.
        const ordersData: RepDashboardData = {
          ...currentData,
          commissions: mappedOrders,
        }

        setOrdersTotalCount(ordersResponse.pagination?.totalCount ?? 0)
        setOrdersTotalPages(ordersResponse.pagination?.totalPages ?? 1)
        setOrdersError(null)
        setData(ordersData)
        localStorage.setItem('repData', JSON.stringify(ordersData))
      } catch (error) {
        // Logged out (refresh token expired/invalid): go to the login page.
        if (isAuthError(error)) {
          clearAuthSession()
          navigate('/')
          return
        }
        // Show why it failed instead of silently keeping old rows.
        if (isMounted) {
          setOrdersError(error instanceof Error ? error.message : 'Failed to load orders')
        }
      } finally {
        if (isMounted) {
          setIsOrdersLoading(false)
        }
      }
    }

    void fetchOrders()
    return () => {
      isMounted = false
    }
  }, [
    location.pathname,
    ordersPage,
    ordersPerPage,
    ordersSearch,
    ordersFromDate,
    ordersToDate,
    ordersSort,
    ordersReloadKey,
    navigate,
  ])

  const handleOrdersSearchSubmit = (event: { preventDefault: () => void }) => {
    event.preventDefault()
    setOrdersSearch(ordersSearchInput.trim())
    setOrdersPage(1)
  }

  const handleOrdersSearchClear = () => {
    setOrdersSearchInput('')
    setOrdersSearch('')
    setOrdersPage(1)
  }

  const handleOrdersPresetChange = (preset: DatePreset) => {
    setOrdersDatePreset(preset)
    if (preset !== 'custom') {
      const range = getPresetRange(preset)
      setOrdersFromDate(range.from)
      setOrdersToDate(range.to)
      setOrdersPage(1)
    }
  }

  const handleOrdersDateChange = (end: 'from' | 'to', value: string) => {
    if (!value) return
    setOrdersDatePreset('custom')
    if (end === 'from') setOrdersFromDate(value)
    else setOrdersToDate(value)
    setOrdersPage(1)
  }

  // Click a header to sort by it; click again to flip the direction.
  const handleOrdersSort = (sortBy: OrdersSortBy) => {
    setOrdersSort((prev) =>
      prev.sortBy === sortBy
        ? { sortBy, sortOrder: prev.sortOrder === 'asc' ? 'desc' : 'asc' }
        : { sortBy, sortOrder: 'desc' }
    )
    setOrdersPage(1)
  }

  const handleOrdersPerPageChange = (value: number) => {
    setOrdersPerPage(value)
    setOrdersPage(1)
  }

  // Open an order's details page; `from` is where its Back button returns to.
  const openOrderDetails = (commissionId: number, from: '/dashboard' | '/dashboard/orders') => {
    navigate(`${ORDER_DETAILS_PATH_PREFIX}${commissionId}`, { state: { from } })
  }

  // Rows act as links: open on click, or Enter/Space when focused.
  const orderRowProps = (commissionId: number, from: '/dashboard' | '/dashboard/orders') => ({
    role: 'link' as const,
    tabIndex: 0,
    onClick: () => openOrderDetails(commissionId, from),
    onKeyDown: (event: { key: string; preventDefault: () => void }) => {
      if (event.key === 'Enter' || event.key === ' ') {
        event.preventDefault()
        openOrderDetails(commissionId, from)
      }
    },
  })

  const goToTab = (tab: ActiveTab) => {
    const tabPath =
      tab === 'orders' ? '/dashboard/orders' : tab === 'profile' ? '/dashboard/profile' : '/dashboard'
    navigate(tabPath)
  }

  useEffect(() => {
    localStorage.setItem('darkMode', String(isDarkMode))
    if (isDarkMode) {
      document.documentElement.classList.add('dark-mode')
    } else {
      document.documentElement.classList.remove('dark-mode')
    }
  }, [isDarkMode])

  const handleLogout = async () => {
    try {
      await logoutRepresentative()
    } catch {
      // Even if backend logout fails, clear local session.
    } finally {
      localStorage.removeItem('repData')
      clearAuthSession()
      navigate('/')
    }
  }

  // Both Logout buttons (sidebar + profile menu) ask for confirmation first.
  const requestLogout = () => {
    setShowProfileDropdown(false)
    setIsMobileMenuOpen(false)
    setShowLogoutConfirm(true)
  }

  const confirmLogout = async () => {
    setIsLoggingOut(true)
    await handleLogout()
  }

  const handleSaveProfile = async () => {
    if (!data) return

    try {
      const response = await updateRepresentativeProfile(
        editedName || data.representative.name || '',
        editedEmail || data.representative.email || ''
      )

      const updatedData: RepDashboardData = {
        ...data,
        representative: {
          ...data.representative,
          id: response.representative.id,
          name: response.representative.name,
          email: response.representative.email,
          status: response.representative.status,
          shop_url: response.representative.shop,
        },
      }

      localStorage.setItem('repData', JSON.stringify(updatedData))
      setData(updatedData)
      setEditedName(updatedData.representative.name || '')
      setEditedEmail(updatedData.representative.email || '')
      setIsProfileEditing(false)
      setShowProfileEdit(false)
      setShowProfileDropdown(false)
    } catch (error) {
      if (isAuthError(error)) {
        clearAuthSession()
        navigate('/')
      }
      // Otherwise keep edit mode open so user can retry.
    }
  }

  const handleEditProfile = () => {
    setIsProfileEditing(true)
    setEditedName(representative.name || '')
    setEditedEmail(representative.email || '')
  }

  const handleCancelEdit = () => {
    setIsProfileEditing(false)
    setEditedName(representative.name || '')
    setEditedEmail(representative.email || '')
  }

  if (!data) {
    return (
      <div className="dashboard-layout">
        <div className="loading">Loading...</div>
      </div>
    )
  }

  const representative = data.representative
  const commissions = Array.isArray(data.commissions) ? data.commissions : []
  const totalCommission =
    data.metrics?.totalCommission ??
    commissions.reduce((sum, commission) => sum + commission.commission_earned, 0)
  const totalOrders = data.metrics?.totalOrders ?? commissions.length

  const getInitials = (name: string | null, email: string) => {
    if (name) {
      return name
        .split(' ')
        .map((n) => n[0])
        .join('')
        .toUpperCase()
        .slice(0, 2)
    }
    // Email can be empty before the profile has loaded.
    return (email?.[0] ?? '?').toUpperCase()
  }

  const formatOrderId = (rawOrderId: string) => {
    if (!rawOrderId) return ''
    // Take the last part after "/" (for gid://shopify/Order/123...)
    const lastSegment = rawOrderId.split('/').pop() ?? rawOrderId
    // Remove any non-digit characters so we only show the numeric part
    const numeric = lastSegment.replace(/\D/g, '')
    return numeric || lastSegment
  }

  return (
    <div className={`dashboard-layout ${isDarkMode ? 'dark-mode' : ''}`}>
      {/* Mobile Overlay */}
      {isMobileMenuOpen && (
        <div
          className="mobile-overlay"
          onClick={() => setIsMobileMenuOpen(false)}
        />
      )}

      {/* Sidebar */}
      <aside className={`dashboard-sidebar ${isMobileMenuOpen ? 'mobile-open' : ''}`}>
        <div className="sidebar-header">
          <div className="sidebar-logo">
            <img
              src="https://cdn.shopify.com/s/files/applications/3ada6a45089326d04bf26bb3132fee51_200x200.png?v=1770212537"
              alt="Commissionly logo"
              className="sidebar-logo-image"
            />
            <span className="logo-text">Commissionly Sales Rep</span>
          </div>
        </div>

        <nav className="sidebar-nav">
          <button
            className={`nav-item ${activeTab === 'dashboard' ? 'active' : ''}`}
            onClick={() => {
              goToTab('dashboard')
              setIsMobileMenuOpen(false)
            }}
          >
            <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
              <rect x="3" y="3" width="7" height="7" />
              <rect x="14" y="3" width="7" height="7" />
              <rect x="14" y="14" width="7" height="7" />
              <rect x="3" y="14" width="7" height="7" />
            </svg>
            <span>Dashboard</span>
          </button>

          <button
            className={`nav-item ${activeTab === 'orders' || activeTab === 'orderDetails' ? 'active' : ''}`}
            onClick={() => {
              goToTab('orders')
              setIsMobileMenuOpen(false)
            }}
          >
            <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
              <path d="M6 2L3 6v14a2 2 0 0 0 2 2h14a2 2 0 0 0 2-2V6l-3-4z" />
              <line x1="3" y1="6" x2="21" y2="6" />
              <path d="M16 10a4 4 0 0 1-8 0" />
            </svg>
            <span>Orders</span>
            {totalOrders > 0 && (
              <span className="nav-badge">{totalOrders}</span>
            )}
          </button>

          <button
            className={`nav-item ${activeTab === 'profile' ? 'active' : ''}`}
            onClick={() => {
              goToTab('profile')
              setIsMobileMenuOpen(false)
            }}
          >
            <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
              <path d="M20 21v-2a4 4 0 0 0-4-4H8a4 4 0 0 0-4 4v2" />
              <circle cx="12" cy="7" r="4" />
            </svg>
            <span>Profile</span>
          </button>
        </nav>

        <div className="sidebar-footer">
          <button
            onClick={requestLogout}
            className="logout-nav-button"
            title="Logout"
          >
            <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
              <path d="M9 21H5a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h4" />
              <polyline points="16 17 21 12 16 7" />
              <line x1="21" y1="12" x2="9" y2="12" />
            </svg>
            <span>Logout</span>
          </button>
        </div>
      </aside>

      {/* Main Content */}
      <div className="dashboard-main">
        {/* Top Navigation */}
        <header className="dashboard-topbar">
          <div className="topbar-left">
            <button
              className="mobile-menu-button"
              onClick={() => setIsMobileMenuOpen(!isMobileMenuOpen)}
              aria-label="Toggle menu"
            >
              <svg width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                {isMobileMenuOpen ? (
                  <>
                    <line x1="18" y1="6" x2="6" y2="18" />
                    <line x1="6" y1="6" x2="18" y2="18" />
                  </>
                ) : (
                  <>
                    <line x1="3" y1="12" x2="21" y2="12" />
                    <line x1="3" y1="6" x2="21" y2="6" />
                    <line x1="3" y1="18" x2="21" y2="18" />
                  </>
                )}
              </svg>
            </button>
          </div>

          <div className="topbar-right">
            <button
              className="theme-toggle-button"
              onClick={() => setIsDarkMode(!isDarkMode)}
              title={isDarkMode ? 'Switch to light mode' : 'Switch to dark mode'}
            >
              {isDarkMode ? (
                <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                  <circle cx="12" cy="12" r="5" />
                  <line x1="12" y1="1" x2="12" y2="3" />
                  <line x1="12" y1="21" x2="12" y2="23" />
                  <line x1="4.22" y1="4.22" x2="5.64" y2="5.64" />
                  <line x1="18.36" y1="18.36" x2="19.78" y2="19.78" />
                  <line x1="1" y1="12" x2="3" y2="12" />
                  <line x1="21" y1="12" x2="23" y2="12" />
                  <line x1="4.22" y1="19.78" x2="5.64" y2="18.36" />
                  <line x1="18.36" y1="5.64" x2="19.78" y2="4.22" />
                </svg>
              ) : (
                <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                  <path d="M21 12.79A9 9 0 1 1 11.21 3 7 7 0 0 0 21 12.79z" />
                </svg>
              )}
            </button>
            <div className="profile-dropdown">
              <button
                className="profile-button"
                onClick={() => setShowProfileDropdown(!showProfileDropdown)}
              >
                <div className="profile-avatar">
                  {getInitials(representative.name, representative.email)}
                </div>
                <div className="profile-info">
                  <span className="profile-name">{representative.name || 'User'}</span>
                  <span className="profile-email">{representative.email}</span>
                </div>
              </button>

              {showProfileDropdown && (
                <div className="profile-dropdown-menu">
                  <button
                    className="dropdown-item"
                    onClick={() => {
                      goToTab('profile')
                      setShowProfileDropdown(false)
                    }}
                  >
                    <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                      <path d="M20 21v-2a4 4 0 0 0-4-4H8a4 4 0 0 0-4 4v2" />
                      <circle cx="12" cy="7" r="4" />
                    </svg>
                    View Profile
                  </button>
                  <button
                    className="dropdown-item"
                    onClick={() => {
                      setShowProfileEdit(true)
                      setShowProfileDropdown(false)
                    }}
                  >
                    <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                      <path d="M11 4H4a2 2 0 0 0-2 2v14a2 2 0 0 0 2 2h14a2 2 0 0 0 2-2v-7" />
                      <path d="M18.5 2.5a2.121 2.121 0 0 1 3 3L12 15l-4 1 1-4 9.5-9.5z" />
                    </svg>
                    Edit Profile
                  </button>
                  <div className="dropdown-divider" />
                  <button className="dropdown-item" onClick={requestLogout}>
                    <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                      <path d="M9 21H5a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h4" />
                      <polyline points="16 17 21 12 16 7" />
                      <line x1="21" y1="12" x2="9" y2="12" />
                    </svg>
                    Logout
                  </button>
                </div>
              )}
            </div>
          </div>
        </header>

        {/* Content Area */}
        <main className="dashboard-content">
          <div className="page-header">
            <div>
              <h1 className="page-title">
                {activeTab === 'dashboard' && 'Dashboard'}
                {activeTab === 'orders' && 'Orders & Commissions'}
                {activeTab === 'orderDetails' && 'Order details'}
                {activeTab === 'profile' && 'Profile'}
              </h1>
              {activeTab === 'dashboard' && (
                <p className="page-subtitle">Overview of your sales performance.</p>
              )}
              {activeTab === 'orders' && (
                <p className="page-subtitle">Detailed view of all orders and commissions.</p>
              )}
              {activeTab === 'orderDetails' && (
                <p className="page-subtitle">Products, amounts and your commission for this order.</p>
              )}
              {activeTab === 'profile' && (
                <p className="page-subtitle">Manage your representative profile information.</p>
              )}
            </div>
          </div>

          {activeTab === 'dashboard' && (
            <>
              {/* Stats Cards */}
              <div className="stats-grid">
                <div className="stat-card stat-primary">
                  <div className="stat-icon">
                    <svg width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                      <line x1="12" y1="1" x2="12" y2="23" />
                      <path d="M17 5H9.5a3.5 3.5 0 0 0 0 7h5a3.5 3.5 0 0 1 0 7H6" />
                    </svg>
                  </div>
                  <div className="stat-content">
                    <p className="stat-label">Total Commission</p>
                    <p className="stat-value">${totalCommission.toFixed(2)}</p>
                  </div>
                </div>

                <div className="stat-card stat-secondary">
                  <div className="stat-icon">
                    <svg width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                      <path d="M6 2L3 6v14a2 2 0 0 0 2 2h14a2 2 0 0 0 2-2V6l-3-4z" />
                      <line x1="3" y1="6" x2="21" y2="6" />
                      <path d="M16 10a4 4 0 0 1-8 0" />
                    </svg>
                  </div>
                  <div className="stat-content">
                    <p className="stat-label">Total Orders</p>
                    <p className="stat-value">{totalOrders}</p>
                  </div>
                </div>

                <div className="stat-card stat-success">
                  <div className="stat-icon">
                    <svg width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                      <path d="M22 11.08V12a10 10 0 1 1-5.93-9.14" />
                      <polyline points="22 4 12 14.01 9 11.01" />
                    </svg>
                  </div>
                  <div className="stat-content">
                    <p className="stat-label">Active Status</p>
                    <p className="stat-value">{representative.status || 'ACTIVE'}</p>
                  </div>
                </div>
              </div>

              {/* Recent Orders Preview */}
              <div className="content-card">
                <div className="card-header">
                  <h2>Recent Orders</h2>
                  <button className="view-all-button" onClick={() => goToTab('orders')}>
                    View All
                    <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                      <polyline points="9 18 15 12 9 6" />
                    </svg>
                  </button>
                </div>
                {commissions.length === 0 ? (
                  <div className="empty-state">
                    <p>No orders found.</p>
                  </div>
                ) : (
                  <div className="orders-preview">
                    {commissions.slice(0, 5).map((commission) => (
                      <div
                        key={commission.id}
                        className="order-preview-item clickable-row"
                        aria-label={`View order ${commission.orderName || formatOrderId(commission.orderId)}`}
                        {...orderRowProps(commission.id, '/dashboard')}
                      >
                        <div className="order-info">
                          <span className="order-id">
                            {/* orderName already includes the "#" (e.g. #1002) */}
                            Order {commission.orderName || `#${formatOrderId(commission.orderId)}`}
                          </span>
                          <span className="order-date">
                            {new Date(commission.createdAt).toLocaleDateString()}
                          </span>
                        </div>
                        <div className="order-amount">
                          <span className="order-value">${commission.orderValue.toFixed(2)}</span>
                          <span className="commission-earned">
                            +${commission.commission_earned.toFixed(2)}
                          </span>
                        </div>
                      </div>
                    ))}
                  </div>
                )}
              </div>
            </>
          )}

          {activeTab === 'orders' && (
            <div className="content-card orders-card">
              <div className="card-header">
                <h2>Orders & Commissions</h2>
                <span className="orders-count">
                  {ordersTotalCount} {ordersTotalCount === 1 ? 'order' : 'orders'}
                </span>
              </div>

              {/* Filter bar: same filters as the admin Orders page */}
              <div className="orders-filters">
                <form className="orders-search" role="search" onSubmit={handleOrdersSearchSubmit}>
                  <div className="orders-search-field">
                    <span className="orders-search-icon">
                      <Icon path={ICON_SEARCH} />
                    </span>
                    <input
                      type="text"
                      inputMode="search"
                      className="orders-search-input"
                      placeholder="Search order #"
                      aria-label="Search orders"
                      value={ordersSearchInput}
                      onChange={(e) => setOrdersSearchInput(e.target.value)}
                    />
                    {(ordersSearch || ordersSearchInput) && (
                      <button
                        type="button"
                        className="orders-search-clear"
                        onClick={handleOrdersSearchClear}
                        aria-label="Clear search"
                        title="Clear search"
                      >
                        <Icon path={ICON_CLOSE} size={14} />
                      </button>
                    )}
                  </div>
                  <button type="submit" className="orders-button orders-button-primary">
                    Search
                  </button>
                </form>

                <div className="orders-date-range">
                  <Select
                    className="orders-date-preset"
                    variant="ghost"
                    ariaLabel="Date range"
                    icon={<Icon path={ICON_CALENDAR} />}
                    options={DATE_PRESET_OPTIONS}
                    value={ordersDatePreset}
                    onChange={handleOrdersPresetChange}
                  />
                  <div className="orders-date-inputs">
                    <label className="orders-date-field">
                      <span className="orders-date-field-label">From</span>
                      <input
                        type="date"
                        className="orders-date-input"
                        aria-label="From date"
                        value={ordersFromDate}
                        max={ordersToDate}
                        onChange={(e) => handleOrdersDateChange('from', e.target.value)}
                      />
                    </label>
                    <span className="orders-date-sep" aria-hidden="true">
                      to
                    </span>
                    <label className="orders-date-field">
                      <span className="orders-date-field-label">To</span>
                      <input
                        type="date"
                        className="orders-date-input"
                        aria-label="To date"
                        value={ordersToDate}
                        min={ordersFromDate}
                        onChange={(e) => handleOrdersDateChange('to', e.target.value)}
                      />
                    </label>
                  </div>
                </div>
              </div>
              <p className="orders-filters-hint">
                Dates are in UTC. Click a column header to sort.
              </p>

              {ordersError && (
                <div className="orders-error" role="alert">
                  <span>Couldn't load orders: {ordersError}</span>
                  <button
                    type="button"
                    className="orders-button"
                    onClick={() => setOrdersReloadKey((key) => key + 1)}
                    disabled={isOrdersLoading}
                  >
                    Retry
                  </button>
                </div>
              )}

              {commissions.length === 0 ? (
                <div className="empty-state">
                  <p>
                    {isOrdersLoading
                      ? 'Loading orders...'
                      : 'No orders found for the selected filters.'}
                  </p>
                </div>
              ) : (
                <div
                  className={`commissions-table-wrapper ${isOrdersLoading ? 'is-loading' : ''}`}
                  aria-busy={isOrdersLoading}
                >
                  <table className="commissions-table orders-table">
                    <thead>
                      <tr>
                        {ORDERS_COLUMNS.map((column) => {
                          if (!column.sortBy) return <th key={column.label}>{column.label}</th>
                          const sortBy = column.sortBy
                          const isActive = ordersSort.sortBy === sortBy
                          return (
                            <th
                              key={column.label}
                              aria-sort={
                                isActive
                                  ? ordersSort.sortOrder === 'asc'
                                    ? 'ascending'
                                    : 'descending'
                                  : 'none'
                              }
                            >
                              <button
                                type="button"
                                className={`sort-header ${isActive ? 'sort-header-active' : ''}`}
                                onClick={() => handleOrdersSort(sortBy)}
                                disabled={isOrdersLoading}
                              >
                                {column.label}
                                <span className="sort-indicator">
                                  <Icon
                                    size={13}
                                    path={
                                      isActive
                                        ? ordersSort.sortOrder === 'asc'
                                          ? ICON_SORT_ASC
                                          : ICON_SORT_DESC
                                        : ICON_SORT
                                    }
                                  />
                                </span>
                              </button>
                            </th>
                          )
                        })}
                      </tr>
                    </thead>
                    <tbody>
                      {commissions.map((commission) => {
                        const items = commission.orderDetails ?? []
                        const hiddenItems = items.length - MAX_VISIBLE_ITEMS
                        // Used by the Status column (commented out below for now).
                        // const status = (commission.status || '').toUpperCase()
                        return (
                          <tr
                            key={commission.id}
                            className="clickable-row"
                            aria-label={`View order ${commission.orderName || formatOrderId(commission.orderId)}`}
                            {...orderRowProps(commission.id, '/dashboard/orders')}
                          >
                            {/* data-label: column name shown on phones, where rows become cards. */}
                            <td className="order-id-cell" data-label="Order ID">
                              {/* Shopify order name (e.g. #1002); fall back to the numeric ID */}
                              {commission.orderName || formatOrderId(commission.orderId)}
                            </td>
                            <td data-label="Order value">${commission.orderValue.toFixed(2)}</td>
                            <td data-label="Commission %">
                              {commission.commissionValue ? `${commission.commissionValue}%` : '-'}
                            </td>
                            <td className="commission-earned" data-label="Earned">
                              ${commission.commission_earned.toFixed(2)}
                            </td>
                            {/* Status column hidden for now (UI only).
                            <td>
                              <span className={`order-status order-status-${status.toLowerCase()}`}>
                                {status || '-'}
                              </span>
                            </td> */}
                            <td className="order-date-cell" data-label="Date">
                              {new Date(commission.createdAt).toLocaleDateString()}
                            </td>
                            <td className="order-items-cell" data-label="Items">
                              {items.length === 0 ? (
                                '—'
                              ) : (
                                <>
                                  {items.slice(0, MAX_VISIBLE_ITEMS).map((item, index) => (
                                    <span key={index} className="order-item">
                                      {formatLineItem(item)}
                                    </span>
                                  ))}
                                  {hiddenItems > 0 && (
                                    <span
                                      className="order-item order-item-more"
                                      title={items.map(formatLineItem).join(', ')}
                                    >
                                      +{hiddenItems} more
                                    </span>
                                  )}
                                </>
                              )}
                            </td>
                          </tr>
                        )
                      })}
                    </tbody>
                  </table>
                </div>
              )}
              <div className="orders-pager">
                <span className="orders-pager-summary">
                  {ordersTotalCount > 0
                    ? `Showing ${(ordersPage - 1) * ordersPerPage + 1}–${Math.min(
                        ordersPage * ordersPerPage,
                        ordersTotalCount
                      )} of ${ordersTotalCount} ${ordersTotalCount === 1 ? 'order' : 'orders'}`
                    : '0 orders'}
                </span>
                <div className="orders-pager-controls">
                  <Select
                    className="orders-per-page"
                    size="sm"
                    label="Rows per page"
                    options={ORDERS_PER_PAGE_OPTIONS.map((size) => ({
                      value: size,
                      label: String(size),
                    }))}
                    value={ordersPerPage}
                    onChange={handleOrdersPerPageChange}
                  />
                  <div className="orders-pager-nav">
                    <button
                      type="button"
                      className="orders-icon-button"
                      onClick={() => setOrdersPage((prev) => Math.max(1, prev - 1))}
                      disabled={ordersPage <= 1 || isOrdersLoading}
                      aria-label="Previous page"
                      title="Previous page"
                    >
                      <Icon path={ICON_CHEVRON_LEFT} />
                    </button>
                    <span className="orders-pager-page">
                      Page {ordersPage} of {Math.max(1, ordersTotalPages)}
                    </span>
                    <button
                      type="button"
                      className="orders-icon-button"
                      onClick={() =>
                        setOrdersPage((prev) => Math.min(Math.max(1, ordersTotalPages), prev + 1))
                      }
                      disabled={ordersPage >= Math.max(1, ordersTotalPages) || isOrdersLoading}
                      aria-label="Next page"
                      title="Next page"
                    >
                      <Icon path={ICON_CHEVRON_RIGHT} />
                    </button>
                  </div>
                </div>
              </div>
            </div>
          )}

          {activeTab === 'orderDetails' && orderIdParam && (
            <OrderDetailsView orderId={orderIdParam} />
          )}

          {activeTab === 'profile' && (
            <div className="content-card">
              <div className="card-header">
                <h2>Profile Information</h2>
                {!isProfileEditing ? (
                  <button
                    className="edit-button"
                    onClick={handleEditProfile}
                  >
                    <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                      <path d="M11 4H4a2 2 0 0 0-2 2v14a2 2 0 0 0 2 2h14a2 2 0 0 0 2-2v-7" />
                      <path d="M18.5 2.5a2.121 2.121 0 0 1 3 3L12 15l-4 1 1-4 9.5-9.5z" />
                    </svg>
                    Edit
                  </button>
                ) : (
                  <div className="profile-action-buttons">
                    <button
                      className="button-secondary"
                      onClick={handleCancelEdit}
                      aria-label="Cancel"
                      title="Cancel"
                    >
                      <svg className="mobile-action-icon" width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                        <line x1="18" y1="6" x2="6" y2="18" />
                        <line x1="6" y1="6" x2="18" y2="18" />
                      </svg>
                      <span className="action-button-text">Cancel</span>
                    </button>
                    <button
                      className="button-primary"
                      onClick={() => void handleSaveProfile()}
                      aria-label="Update"
                      title="Update"
                    >
                      <svg className="mobile-action-icon" width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                        <polyline points="20 6 9 17 4 12" />
                      </svg>
                      <span className="action-button-text">Update</span>
                    </button>
                  </div>
                )}
              </div>
              <div className="profile-details">
                <div className="profile-avatar-large">
                  {getInitials(representative.name, representative.email)}
                </div>
                <div className="profile-info-grid">
                  <div className="info-row">
                    <label className="info-label" htmlFor="profile-name">Name</label>
                    <input
                      id="profile-name"
                      type="text"
                      className="profile-input"
                      value={editedName}
                      placeholder="Name"
                      onChange={(e) => setEditedName(e.target.value)}
                      disabled={!isProfileEditing}
                    />
                  </div>
                  <div className="info-row">
                    <label className="info-label" htmlFor="profile-email">Email</label>
                    <input
                      id="profile-email"
                      type="email"
                      className="profile-input"
                      value={editedEmail}
                      placeholder="Email"
                      onChange={(e) => setEditedEmail(e.target.value)}
                      disabled={!isProfileEditing}
                    />
                  </div>
                  <div className="info-row">
                    <label className="info-label" htmlFor="profile-shop-value">Shop Value</label>
                    <input
                      id="profile-shop-value"
                      type="text"
                      className="profile-input"
                      value={representative.shop_url}
                      placeholder="Shop Value"
                      disabled
                    />
                  </div>
                  <div className="info-row">
                    <label className="info-label" htmlFor="profile-commission">Total Commission</label>
                    <input
                      id="profile-commission"
                      type="text"
                      className="profile-input"
                      value={`$${totalCommission.toFixed(2)}`}
                      placeholder="Total Commission"
                      disabled
                    />
                  </div>
                </div>
              </div>
            </div>
          )}
        </main>
      </div>

      {/* Profile Edit Modal */}
      {showProfileEdit && (
        <div className="modal-overlay" onClick={() => setShowProfileEdit(false)}>
          <div className="modal-content" onClick={(e) => e.stopPropagation()}>
            <div className="modal-header">
              <h3>Edit Profile</h3>
              <button className="modal-close" onClick={() => setShowProfileEdit(false)}>
                <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                  <line x1="18" y1="6" x2="6" y2="18" />
                  <line x1="6" y1="6" x2="18" y2="18" />
                </svg>
              </button>
            </div>
            <div className="modal-body">
              <div className="form-field">
                <label htmlFor="edit-name">Name</label>
                <input
                  id="edit-name"
                  type="text"
                  value={editedName}
                  onChange={(e) => setEditedName(e.target.value)}
                  placeholder="Enter your name"
                />
              </div>
              <div className="form-field">
                <label htmlFor="edit-email">Email</label>
                <input
                  id="edit-email"
                  type="email"
                  value={editedEmail}
                  onChange={(e) => setEditedEmail(e.target.value)}
                />
                <small>Email can be updated</small>
              </div>
            </div>
            <div className="modal-footer">
              <button className="button-secondary" onClick={() => setShowProfileEdit(false)}>
                Cancel
              </button>
              <button className="button-primary" onClick={() => void handleSaveProfile()}>
                Save Changes
              </button>
            </div>
          </div>
        </div>
      )}

      <ConfirmDialog
        open={showLogoutConfirm}
        tone="danger"
        title="Log out?"
        message="You'll need to sign in again to see your orders and commissions."
        confirmLabel="Log out"
        loading={isLoggingOut}
        loadingLabel="Logging out..."
        icon={
          <svg width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
            <path d="M9 21H5a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h4" />
            <polyline points="16 17 21 12 16 7" />
            <line x1="21" y1="12" x2="9" y2="12" />
          </svg>
        }
        onConfirm={() => void confirmLogout()}
        onCancel={() => setShowLogoutConfirm(false)}
      />
    </div>
  )
}
