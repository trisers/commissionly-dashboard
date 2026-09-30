const BASE_URL =
  import.meta.env.VITE_REP_API_BASE_URL ??
  'https://hence-artistic-laser-industry.trycloudflare.com'

export type Representative = {
  id: number
  name: string | null
  email: string
  staff_id: string
  shop_url?: string
  status?: string
}

/** One product line of an order, as sent by /api/rep/orders. */
export type OrderLineItem = {
  title: string
  variantTitle: string | null
  sku: string | null
  quantity: number
  price: number
}

export type Commission = {
  id: number
  orderId: string
  orderName?: string | null
  orderDetails?: OrderLineItem[]
  orderValue: number
  commissionValue: number
  commission_type: string
  commission_earned: number
  status?: string
  createdAt: string
}

export type LoginResponse = {
  valid: boolean
  accessToken?: string
  tokenType?: string
  expiresIn?: number
}

export type RepDashboardData = {
  representative: Representative
  commissions: Commission[]
  metrics: {
    totalCommission: number
    totalOrders: number
  }
}

export type RepProfileResponse = {
  representative: {
    id: number
    name: string | null
    email: string
    status: 'ACTIVE' | 'INACTIVE'
  }
  store: {
    shop: string
    createdAt: string | null
    updatedAt: string | null
  }
}

export type RepProfileUpdateResponse = {
  success: boolean
  representative: {
    id: number
    name: string | null
    email: string
    status: 'ACTIVE' | 'INACTIVE'
    shop: string
  }
}

type RepDetailsApiResponse = {
  account?: {
    status?: string
    name?: string
    email?: string
    shop?: string
  }
  metrics?: {
    totalCommission?: number
    totalOrders?: number
  }
  recentOrders?: Array<{
    id?: number
    orderId?: string
    orderName?: string | null
    orderValue?: number
    commission_earned?: number
    status?: string
    createdAt?: string
  }>
}

export type AuthSession = {
  accessToken: string
  tokenType: string
  /** Access token lifetime in seconds, as returned by login/refresh. */
  expiresIn: number
  /** When the access token expires (ms since epoch); set by saveAuthSession. */
  expiresAt?: number
}

/** Thrown when the rep is not (or no longer) logged in; pages send them to login. */
export class AuthError extends Error {
  constructor(message = 'Session expired. Please login again.') {
    super(message)
    this.name = 'AuthError'
  }
}

export function isAuthError(error: unknown): error is AuthError {
  return error instanceof AuthError
}

const AUTH_STORAGE_KEY = 'repAuth'
// Refresh this long before the access token expires, to avoid a 401 round trip.
const REFRESH_EARLY_MS = 60 * 1000
let refreshInFlight: Promise<void> | null = null

export function saveAuthSession(session: AuthSession): void {
  const expiresAt =
    session.expiresAt ?? (session.expiresIn > 0 ? Date.now() + session.expiresIn * 1000 : undefined)
  localStorage.setItem(AUTH_STORAGE_KEY, JSON.stringify({ ...session, expiresAt }))
}

export function getAuthSession(): AuthSession | null {
  const storedSession = localStorage.getItem(AUTH_STORAGE_KEY)
  if (!storedSession) return null

  try {
    return JSON.parse(storedSession) as AuthSession
  } catch {
    localStorage.removeItem(AUTH_STORAGE_KEY)
    return null
  }
}

export function clearAuthSession(): void {
  localStorage.removeItem(AUTH_STORAGE_KEY)
}

function getAuthorizationHeader(): Record<string, string> {
  const session = getAuthSession()
  if (!session?.accessToken) {
    throw new AuthError('You are not logged in. Please login again.')
  }

  return {
    Authorization: `${session.tokenType || 'Bearer'} ${session.accessToken}`,
  }
}

/**
 * Exchanges the refresh-token cookie for a new access token (the server also
 * rotates the cookie). Throws AuthError only when the server rejects the
 * refresh token; network/server errors throw a plain Error so a flaky
 * connection doesn't log the rep out.
 */
async function refreshAccessToken(): Promise<void> {
  const tokenBefore = getAuthSession()?.accessToken

  let res: Response
  try {
    res = await fetch(`${BASE_URL}/api/rep/refresh`, {
      method: 'POST',
      credentials: 'include',
    })
  } catch {
    throw new Error('Network error while refreshing the session. Please try again.')
  }

  let data: { accessToken?: string; tokenType?: string; expiresIn?: number; error?: string } | null =
    null
  try {
    data = await res.json()
  } catch {
    // Non-JSON body (e.g. tunnel error page); handled below.
  }

  if (res.ok && data?.accessToken) {
    saveAuthSession({
      accessToken: data.accessToken,
      tokenType: data.tokenType || 'Bearer',
      expiresIn: data.expiresIn || 0,
    })
    return
  }

  if (res.status === 401 || res.status === 403) {
    // Another tab may have refreshed at the same time: the server rotated the
    // shared refresh cookie for that tab and rejected ours. If a new token was
    // saved meanwhile, keep using it instead of logging out.
    const tokenNow = getAuthSession()?.accessToken
    if (tokenNow && tokenNow !== tokenBefore) return
    throw new AuthError()
  }

  throw new Error(data?.error || `Unable to refresh session (HTTP ${res.status})`)
}

async function ensureRefreshedAccessToken(): Promise<void> {
  if (!refreshInFlight) {
    refreshInFlight = refreshAccessToken().finally(() => {
      refreshInFlight = null
    })
  }
  await refreshInFlight
}

async function refreshOrLogout(): Promise<void> {
  try {
    await ensureRefreshedAccessToken()
  } catch (error) {
    if (isAuthError(error)) clearAuthSession()
    throw error
  }
}

async function fetchWithAuthRetry(
  url: string,
  init: RequestInit,
  allowRetry = true
): Promise<Response> {
  // Refresh shortly before the access token expires instead of waiting for a 401.
  const session = getAuthSession()
  if (allowRetry && session?.expiresAt && session.expiresAt - Date.now() < REFRESH_EARLY_MS) {
    try {
      await refreshOrLogout()
    } catch (error) {
      if (isAuthError(error)) throw error
      // Network hiccup: try the request anyway; the 401 path below retries.
    }
  }

  const authHeaders = getAuthorizationHeader()
  const headers = {
    ...(init.headers as Record<string, string> | undefined),
    ...authHeaders,
  }

  const res = await fetch(url, {
    ...init,
    headers,
    credentials: 'include',
  })

  if (res.status === 401 && allowRetry) {
    await refreshOrLogout()
    return fetchWithAuthRetry(url, init, false)
  }

  if (res.status === 401) {
    // Still rejected right after a successful refresh.
    clearAuthSession()
    throw new AuthError()
  }

  return res
}

function mapDetailsResponseToDashboardData(data: RepDetailsApiResponse): RepDashboardData {
  const commissions: Commission[] = Array.isArray(data.recentOrders)
    ? data.recentOrders.map((order) => ({
        id: order.id ?? 0,
        orderId: order.orderId ?? '',
        orderName: order.orderName ?? null,
        orderValue: order.orderValue ?? 0,
        commission_earned: order.commission_earned ?? 0,
        status: order.status ?? '',
        createdAt: order.createdAt ?? '',
        commissionValue: 0,
        commission_type: '',
      }))
    : []

  return {
    representative: {
      id: 0,
      name: data.account?.name ?? null,
      email: data.account?.email ?? '',
      staff_id: '',
      shop_url: data.account?.shop ?? '',
      status: data.account?.status ?? 'ACTIVE',
    },
    commissions,
    metrics: {
      totalCommission:
        data.metrics?.totalCommission ??
        commissions.reduce((sum, commission) => sum + commission.commission_earned, 0),
      totalOrders: data.metrics?.totalOrders ?? commissions.length,
    },
  }
}

export async function loginRepresentative(email: string, password: string): Promise<LoginResponse> {
  const res = await fetch(`${BASE_URL}/api/rep/login`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({ email, password }),
    credentials: 'include',
  })

  const data = await res.json()

  if (!res.ok) {
    throw new Error(data?.error || 'Login failed')
  }

  return data as LoginResponse
}

export async function getRepresentativeDetails(): Promise<RepDashboardData> {
  const res = await fetchWithAuthRetry(`${BASE_URL}/api/rep/details`, {
    method: 'GET',
  })

  const data = await res.json()

  if (!res.ok) {
    throw new Error(data?.error || 'Failed to fetch representative details')
  }

  return mapDetailsResponseToDashboardData(data as RepDetailsApiResponse)
}

export async function updateRepresentativeProfile(
  name: string,
  email: string
): Promise<RepProfileUpdateResponse> {
  const res = await fetchWithAuthRetry(`${BASE_URL}/api/rep/profile`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({ name, email }),
  })

  const data = await res.json()

  if (!res.ok) {
    throw new Error(data?.error || 'Failed to update profile')
  }

  return data as RepProfileUpdateResponse
}

export async function getRepresentativeProfile(): Promise<RepProfileResponse> {
  const res = await fetchWithAuthRetry(`${BASE_URL}/api/rep/profile`, {
    method: 'GET',
  })

  const data = await res.json()

  if (!res.ok) {
    throw new Error(data?.error || 'Failed to fetch representative profile')
  }

  return data as RepProfileResponse
}

export async function logoutRepresentative(): Promise<void> {
  const res = await fetch(`${BASE_URL}/api/rep/logout`, {
    method: 'POST',
    credentials: 'include',
  })

  if (!res.ok) {
    let message = 'Logout failed'
    try {
      const data = await res.json()
      message = data?.error || message
    } catch {
      // no-op
    }
    throw new Error(message)
  }
}

export type PasswordResetRequestResponse = {
  success: boolean
  message: string
}

export async function requestPasswordReset(email: string): Promise<PasswordResetRequestResponse> {
  const res = await fetch(`${BASE_URL}/api/rep/password-reset-request`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({ email }),
    credentials: 'include',
  })

  const data = await res.json()

  if (!res.ok) {
    throw new Error(data?.error || 'Failed to send reset email')
  }

  return data as PasswordResetRequestResponse
}

export type PasswordResetResponse = {
  success: boolean
  message: string
}

/** Sortable Orders table columns (same ids as the admin Orders table). */
export type OrdersSortBy =
  | 'orderId'
  | 'orderValue'
  | 'commissionPercent'
  | 'commissionEarned'
  | 'status'
  | 'date'

export type OrdersFilters = {
  /** Matches order name (#1002) or Shopify order ID. */
  search?: string
  sortBy?: OrdersSortBy
  sortOrder?: 'asc' | 'desc'
  /** YYYY-MM-DD (UTC); both ends are needed for the range to apply. */
  fromDate?: string | null
  toDate?: string | null
}

export type OrdersTableRequest = {
  filters: OrdersFilters
  pagination: {
    page: number
    perPage: number
  }
}

export type OrdersTableResponse = {
  filters: OrdersFilters
  pagination: {
    page: number
    perPage: number
    totalCount: number
    totalPages: number
  }
  orders: Array<{
    id: number
    orderId: string
    orderName: string | null
    orderDetails?: OrderLineItem[]
    orderValue: number
    commissionValue: number
    commission_type: string
    commission_earned: number
    status: string
    createdAt: string
    updatedAt: string
  }>
}

export async function getOrdersTableData(payload: OrdersTableRequest): Promise<OrdersTableResponse> {
  const res = await fetchWithAuthRetry(`${BASE_URL}/api/rep/orders`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
    },
    body: JSON.stringify(payload),
  })

  const data = await res.json()

  if (!res.ok) {
    throw new Error(data?.error || 'Failed to fetch orders table data')
  }

  return data as OrdersTableResponse
}

export type OrderDetails = {
  id: number
  orderId: string
  orderName: string | null
  orderDetails: OrderLineItem[]
  orderValue: number
  commissionValue: number
  commission_type: string
  commission_earned: number
  createdAt: string
  updatedAt: string
}

/** One order (by commission id) for the Order details page. */
export async function getOrderDetails(id: number | string): Promise<OrderDetails> {
  const res = await fetchWithAuthRetry(
    `${BASE_URL}/api/rep/order/${encodeURIComponent(String(id))}`,
    { method: 'GET' }
  )

  const data = await res.json()

  if (!res.ok) {
    throw new Error(data?.error || 'Failed to fetch order details')
  }

  return data.order as OrderDetails
}

export async function resetPassword(
  email: string,
  token: string,
  newPassword: string
): Promise<PasswordResetResponse> {
  const res = await fetch(`${BASE_URL}/api/rep/password-reset`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({ email, token, newPassword }),
    credentials: 'include',
  })

  const data = await res.json()

  if (!res.ok) {
    throw new Error(data?.error || 'Failed to reset password')
  }

  return data as PasswordResetResponse
}
