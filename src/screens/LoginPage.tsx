import { useState } from 'react'
import type { FormEvent } from 'react'
import { Link, useNavigate } from 'react-router-dom'
import { loginRepresentative, saveAuthSession } from '../api/repApi'
import type { RepDashboardData } from '../api/repApi'
import './auth.css'

export const LoginPage = () => {
  const navigate = useNavigate()
  const [email, setEmail] = useState('')
  const [password, setPassword] = useState('')
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [success, setSuccess] = useState<string | null>(null)

  const handleSubmit = async (e: FormEvent) => {
    e.preventDefault()
    setError(null)
    setSuccess(null)

    if (!email.trim() || !password) {
      setError('Email and password are required')
      return
    }

    try {
      setLoading(true)
      const normalizedEmail = email.trim().toLowerCase()
      const res = await loginRepresentative(normalizedEmail, password)

      if (!res.valid) {
        setError('Invalid login credentials')
        return
      }

      if (!res.accessToken) {
        setError('Login succeeded but token is missing')
        return
      }

      saveAuthSession({
        accessToken: res.accessToken,
        tokenType: res.tokenType || 'Bearer',
        expiresIn: res.expiresIn || 0,
      })

      // Login API returns auth token; keep minimal profile for current UI.
      // Store minimal dashboard data required by current UI.
      const dashboardData: RepDashboardData = {
        representative: {
          id: 0,
          name: null,
          email: normalizedEmail,
          staff_id: '',
          shop_url: '',
          status: 'ACTIVE',
        },
        commissions: [],
        metrics: {
          totalCommission: 0,
          totalOrders: 0,
        },
      }

      localStorage.setItem('repData', JSON.stringify(dashboardData))
      navigate('/dashboard')
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Login failed')
    } finally {
      setLoading(false)
    }
  }

  return (
    <div className="auth-container">
      <div className="auth-card">
        <h1 className="auth-title">Sales Rep Portal</h1>
        <p className="auth-subtitle">Sign in to manage your Shopify sales reps</p>

        <form className="auth-form" onSubmit={handleSubmit}>
          <div className="field">
            <label htmlFor="email">Email</label>
            <input
              id="email"
              type="email"
              required
              placeholder="you@example.com"
              value={email}
              onChange={(e) => setEmail(e.target.value)}
            />
          </div>

          <div className="field">
            <label htmlFor="password">Password</label>
            <input
              id="password"
              type="password"
              required
              placeholder="••••••••"
              value={password}
              onChange={(e) => setPassword(e.target.value)}
            />
          </div>

          <button type="submit" className="primary-button">
            {loading ? 'Logging in...' : 'Log in'}
          </button>

          {error && <p className="auth-message auth-error">{error}</p>}
          {success && <p className="auth-message auth-success">{success}</p>}

          <div className="auth-footer">
            <Link to="/reset-password">Forgot your password?</Link>
          </div>
        </form>
      </div>
    </div>
  )
}

