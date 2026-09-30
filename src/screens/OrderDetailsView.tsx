import { useEffect, useState } from 'react'
import { useLocation, useNavigate } from 'react-router-dom'
import { clearAuthSession, getOrderDetails, isAuthError } from '../api/repApi'
import type { OrderDetails, OrderLineItem } from '../api/repApi'

type OrderDetailsViewProps = {
  /** Commission id from the URL (/dashboard/orders/:orderId). */
  orderId: string
}

const money = (value: number) => `$${(Number.isFinite(value) ? value : 0).toFixed(2)}`

const formatDateTime = (iso: string) => {
  const date = new Date(iso)
  return Number.isNaN(date.getTime())
    ? '-'
    : date.toLocaleString(undefined, { dateStyle: 'medium', timeStyle: 'short' })
}

/** "gid://shopify/Order/123" → "123" */
const shopifyNumericId = (rawOrderId: string) =>
  (rawOrderId.split('/').pop() ?? rawOrderId).replace(/\D/g, '') || rawOrderId

const variantLabel = (item: OrderLineItem) =>
  item.variantTitle && item.variantTitle !== 'Default Title' ? item.variantTitle : null

const commissionRateLabel = (order: OrderDetails) =>
  order.commission_type === 'FIXED' ? money(order.commissionValue) : `${order.commissionValue}%`

const commissionTypeLabel = (type: string) =>
  type === 'FIXED' ? 'Fixed amount' : type === 'PERCENTAGE' ? 'Percentage' : type || '-'

export function OrderDetailsView({ orderId }: OrderDetailsViewProps) {
  const navigate = useNavigate()
  const location = useLocation()
  const [reloadKey, setReloadKey] = useState(0)
  // Result of the last finished request, tagged with the order/retry it was for;
  // while it doesn't match the current one, the page is loading.
  const requestKey = `${orderId}:${reloadKey}`
  const [result, setResult] = useState<{
    key: string
    order: OrderDetails | null
    error: string | null
  } | null>(null)
  const loading = result?.key !== requestKey
  const order = result?.order ?? null
  const error = loading ? null : result?.error ?? null

  // Go back to where the rep came from (Dashboard or Orders), Orders by default.
  const backTo = (location.state as { from?: string } | null)?.from ?? '/dashboard/orders'
  const backLabel = backTo === '/dashboard' ? 'Back to dashboard' : 'Back to orders'

  useEffect(() => {
    let isMounted = true

    getOrderDetails(orderId)
      .then((data) => {
        if (isMounted) setResult({ key: requestKey, order: data, error: null })
      })
      .catch((err: unknown) => {
        if (isAuthError(err)) {
          clearAuthSession()
          navigate('/')
          return
        }
        if (isMounted) {
          setResult({
            key: requestKey,
            order: null,
            error: err instanceof Error ? err.message : 'Failed to load order',
          })
        }
      })

    return () => {
      isMounted = false
    }
  }, [orderId, requestKey, navigate])

  const backButton = (
    <button type="button" className="od-back" onClick={() => navigate(backTo)}>
      <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
        <path d="M15 18l-6-6 6-6" />
      </svg>
      {backLabel}
    </button>
  )

  if (loading && !order) {
    return (
      <div className="od-page">
        {backButton}
        <div className="content-card">
          <div className="empty-state">
            <p>Loading order...</p>
          </div>
        </div>
      </div>
    )
  }

  if (error || !order) {
    return (
      <div className="od-page">
        {backButton}
        <div className="content-card">
          <div className="empty-state">
            <p>{error === 'Order not found' ? 'This order was not found.' : `Couldn't load this order: ${error}`}</p>
            {error !== 'Order not found' && (
              <button type="button" className="orders-button" onClick={() => setReloadKey((k) => k + 1)}>
                Retry
              </button>
            )}
          </div>
        </div>
      </div>
    )
  }

  const items = order.orderDetails ?? []
  const itemsSubtotal = items.reduce((sum, item) => sum + item.price * item.quantity, 0)
  const totalQuantity = items.reduce((sum, item) => sum + item.quantity, 0)
  const orderLabel = order.orderName || `#${shopifyNumericId(order.orderId)}`

  return (
    <div className={`od-page ${loading ? 'is-loading' : ''}`}>
      {backButton}

      {/* Order header */}
      <div className="content-card od-header">
        <div>
          <p className="od-eyebrow">Order</p>
          <h2 className="od-title">{orderLabel}</h2>
          <p className="od-meta">Placed on {formatDateTime(order.createdAt)}</p>
        </div>
        <div className="od-header-earned">
          <span className="od-eyebrow">Your commission</span>
          <span className="od-earned-value">{money(order.commission_earned)}</span>
        </div>
      </div>

      {/* Summary */}
      <div className="od-summary">
        <div className="od-summary-card">
          <span className="od-summary-label">Order value</span>
          <span className="od-summary-value">{money(order.orderValue)}</span>
        </div>
        <div className="od-summary-card">
          <span className="od-summary-label">Commission rate</span>
          <span className="od-summary-value">{commissionRateLabel(order)}</span>
        </div>
        <div className="od-summary-card">
          <span className="od-summary-label">Commission earned</span>
          <span className="od-summary-value od-positive">{money(order.commission_earned)}</span>
        </div>
        <div className="od-summary-card">
          <span className="od-summary-label">Items</span>
          <span className="od-summary-value">{totalQuantity}</span>
        </div>
      </div>

      <div className="od-grid">
        {/* Line items */}
        <div className="content-card od-items">
          <div className="card-header">
            <h2>Items</h2>
            <span className="orders-count">
              {items.length} {items.length === 1 ? 'product' : 'products'}
            </span>
          </div>
          {items.length === 0 ? (
            <div className="empty-state">
              <p>No item details were saved for this order.</p>
            </div>
          ) : (
            <>
              <div className="commissions-table-wrapper">
                <table className="commissions-table od-items-table">
                  <thead>
                    <tr>
                      <th>Product</th>
                      <th>SKU</th>
                      <th className="od-num">Price</th>
                      <th className="od-num">Qty</th>
                      <th className="od-num">Total</th>
                    </tr>
                  </thead>
                  <tbody>
                    {items.map((item, index) => (
                      <tr key={index}>
                        <td>
                          <span className="od-product">{item.title}</span>
                          {variantLabel(item) && (
                            <span className="od-variant">{variantLabel(item)}</span>
                          )}
                        </td>
                        <td>{item.sku || '-'}</td>
                        <td className="od-num">{money(item.price)}</td>
                        <td className="od-num">× {item.quantity}</td>
                        <td className="od-num od-strong">{money(item.price * item.quantity)}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
              <dl className="od-totals">
                <div>
                  <dt>Items subtotal</dt>
                  <dd>{money(itemsSubtotal)}</dd>
                </div>
                <div className="od-totals-main">
                  <dt>Order value</dt>
                  <dd>{money(order.orderValue)}</dd>
                </div>
              </dl>
              {Math.abs(itemsSubtotal - order.orderValue) >= 0.01 && (
                <p className="od-note">
                  Order value can differ from the items subtotal because of discounts, shipping or taxes.
                </p>
              )}
            </>
          )}
        </div>

        {/* Order & commission details */}
        <div className="content-card od-info">
          <div className="card-header">
            <h2>Details</h2>
          </div>
          <dl className="od-info-list">
            <div>
              <dt>Order number</dt>
              <dd>{orderLabel}</dd>
            </div>
            <div>
              <dt>Shopify order ID</dt>
              <dd className="od-mono">{shopifyNumericId(order.orderId)}</dd>
            </div>
            <div>
              <dt>Placed on</dt>
              <dd>{formatDateTime(order.createdAt)}</dd>
            </div>
            <div>
              <dt>Last updated</dt>
              <dd>{formatDateTime(order.updatedAt)}</dd>
            </div>
            <div>
              <dt>Commission type</dt>
              <dd>{commissionTypeLabel(order.commission_type)}</dd>
            </div>
            <div>
              <dt>Commission rate</dt>
              <dd>{commissionRateLabel(order)}</dd>
            </div>
            <div>
              <dt>Commission earned</dt>
              <dd className="od-positive">{money(order.commission_earned)}</dd>
            </div>
          </dl>
        </div>
      </div>
    </div>
  )
}
