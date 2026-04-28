const BASE_URL =
  import.meta.env.VITE_REP_API_BASE_URL ??
  ''

export type Representative = {
  id: number
  name: string | null
  email: string
  staff_id: string
  shop_url?: string
  status?: string
}

export type Commission = {
  id: number
  orderId: string
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
    orderValue?: number
    commission_earned?: number
    status?: string
    createdAt?: string
  }>
}

export type AuthSession = {
  accessToken: string
  tokenType: string
  expiresIn: number
}

const AUTH_STORAGE_KEY = 'repAuth'
let refreshInFlight: Promise<void> | null = null

export function saveAuthSession(session: AuthSession): void {
  localStorage.setItem(AUTH_STORAGE_KEY, JSON.stringify(session))
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
    throw new Error('Missing auth token. Please login again.')
  }

  return {
    Authorization: `${session.tokenType || 'Bearer'} ${session.accessToken}`,
  }
}

async function refreshAccessToken(): Promise<void> {
  const res = await fetch(`${BASE_URL}/api/rep/refresh`, {
    method: 'POST',
    credentials: 'include',
  })

  const data = await res.json()
  if (!res.ok || !data?.accessToken) {
    throw new Error(data?.error || 'Unable to refresh access token')
  }

  saveAuthSession({
    accessToken: data.accessToken,
    tokenType: data.tokenType || 'Bearer',
    expiresIn: data.expiresIn || 0,
  })
}

async function ensureRefreshedAccessToken(): Promise<void> {
  if (!refreshInFlight) {
    refreshInFlight = refreshAccessToken().finally(() => {
      refreshInFlight = null
    })
  }
  await refreshInFlight
}

async function fetchWithAuthRetry(
  url: string,
  init: RequestInit,
  allowRetry = true
): Promise<Response> {
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
    try {
      await ensureRefreshedAccessToken()
    } catch {
      clearAuthSession()
      throw new Error('Session expired. Please login again.')
    }

    return fetchWithAuthRetry(url, init, false)
  }

  return res
}

function mapDetailsResponseToDashboardData(data: RepDetailsApiResponse): RepDashboardData {
  const commissions: Commission[] = Array.isArray(data.recentOrders)
    ? data.recentOrders.map((order) => ({
        id: order.id ?? 0,
        orderId: order.orderId ?? '',
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

export type OrdersFilters = {
  search?: string
  status?: '' | 'PENDING' | 'APPROVED' | 'PAID' | 'REJECTED'
  sortBy?: 'createdAt' | 'orderValue' | 'commission_earned' | 'orderId'
  sortDir?: 'asc' | 'desc'
  fromDate?: string
  toDate?: string
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
