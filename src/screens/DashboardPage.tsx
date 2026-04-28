import { useEffect, useState } from 'react'
import { useLocation, useNavigate } from 'react-router-dom'
import {
  clearAuthSession,
  getOrdersTableData,
  getRepresentativeDetails,
  getRepresentativeProfile,
  logoutRepresentative,
  updateRepresentativeProfile,
} from '../api/repApi'
import type { RepDashboardData } from '../api/repApi'
import './dashboard.css'

type ActiveTab = 'dashboard' | 'orders' | 'profile'

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
  const [data, setData] = useState<RepDashboardData | null>(null)
  const [activeTab, setActiveTab] = useState<ActiveTab>('dashboard')
  const [showProfileDropdown, setShowProfileDropdown] = useState(false)
  const [showProfileEdit, setShowProfileEdit] = useState(false)
  const [isProfileEditing, setIsProfileEditing] = useState(false)
  const [editedName, setEditedName] = useState('')
  const [editedEmail, setEditedEmail] = useState('')
  const [isMobileMenuOpen, setIsMobileMenuOpen] = useState(false)
  const [ordersPage, setOrdersPage] = useState(1)
  const [ordersTotalCount, setOrdersTotalCount] = useState(0)
  const [ordersTotalPages, setOrdersTotalPages] = useState(1)
  const [isOrdersLoading, setIsOrdersLoading] = useState(false)
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
    if (location.pathname === '/dashboard/profile') {
      setActiveTab('profile')
      return
    }
    setActiveTab('dashboard')
  }, [location.pathname])

  useEffect(() => {
    if (activeTab !== 'orders') return
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
      } catch {
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
          filters: {},
          pagination: {
            page: ordersPage,
            perPage: 10,
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
          orderValue: order.orderValue,
          commissionValue: order.commissionValue,
          commission_type: order.commission_type,
          commission_earned: order.commission_earned,
          status: order.status,
          createdAt: order.createdAt,
        }))

        const ordersData: RepDashboardData = {
          ...currentData,
          commissions: mappedOrders,
          metrics: {
            totalOrders: ordersResponse.pagination?.totalCount ?? 0,
            totalCommission: mappedOrders.reduce(
              (sum, order) => sum + (order.commission_earned ?? 0),
              0
            ),
          },
        }

        setOrdersTotalCount(ordersResponse.pagination?.totalCount ?? 0)
        setOrdersTotalPages(ordersResponse.pagination?.totalPages ?? 1)
        setData(ordersData)
        localStorage.setItem('repData', JSON.stringify(ordersData))
      } catch {
        // Keep existing table data on fetch failure.
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
  }, [location.pathname, ordersPage])

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
    } catch {
      // Keep edit mode open so user can retry.
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
    return email[0].toUpperCase()
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
            className={`nav-item ${activeTab === 'orders' ? 'active' : ''}`}
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
            onClick={() => {
              void handleLogout()
              setIsMobileMenuOpen(false)
            }}
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
                  <button className="dropdown-item" onClick={() => void handleLogout()}>
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
                {activeTab === 'profile' && 'Profile'}
              </h1>
              {activeTab === 'dashboard' && (
                <p className="page-subtitle">Overview of your sales performance.</p>
              )}
              {activeTab === 'orders' && (
                <p className="page-subtitle">Detailed view of all orders and commissions.</p>
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
                      <div key={commission.id} className="order-preview-item">
                        <div className="order-info">
                          <span className="order-id">
                            Order #{formatOrderId(commission.orderId)}
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
            <div className="content-card">
              <div className="card-header">
                <h2>Orders & Commissions</h2>
                <span className="orders-count">{ordersTotalCount || totalOrders} orders</span>
              </div>
              {isOrdersLoading && (
                <div className="empty-state">
                  <p>Loading orders...</p>
                </div>
              )}
              {!isOrdersLoading && commissions.length === 0 ? (
                <div className="empty-state">
                  <p>No commissions found.</p>
                </div>
              ) : (
                <div className="commissions-table-wrapper">
                  <table className="commissions-table">
                    <thead>
                      <tr>
                        <th>Order ID</th>
                        <th>Order Value</th>
                        <th>Commission Type</th>
                        <th>Commission Rate</th>
                        <th>Commission Earned</th>
                        <th>Date</th>
                      </tr>
                    </thead>
                    <tbody>
                      {commissions.map((commission) => (
                        <tr key={commission.id}>
                          <td className="order-id-cell">
                            {formatOrderId(commission.orderId)}
                          </td>
                          <td>${commission.orderValue.toFixed(2)}</td>
                          <td>{commission.commission_type || '-'}</td>
                          <td>{commission.commissionValue ? `${commission.commissionValue}%` : '-'}</td>
                          <td className="commission-earned">
                            ${commission.commission_earned.toFixed(2)}
                          </td>
                          <td>{new Date(commission.createdAt).toLocaleDateString()}</td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              )}
              <div className="orders-pagination">
                <button
                  className="button-secondary"
                  onClick={() => setOrdersPage((prev) => Math.max(1, prev - 1))}
                  disabled={ordersPage <= 1 || isOrdersLoading}
                >
                  Previous
                </button>
                <span className="orders-count">
                  Page {ordersPage} of {Math.max(1, ordersTotalPages)}
                </span>
                <button
                  className="button-secondary"
                  onClick={() => setOrdersPage((prev) => Math.min(Math.max(1, ordersTotalPages), prev + 1))}
                  disabled={ordersPage >= Math.max(1, ordersTotalPages) || isOrdersLoading}
                >
                  Next
                </button>
              </div>
            </div>
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
    </div>
  )
}
