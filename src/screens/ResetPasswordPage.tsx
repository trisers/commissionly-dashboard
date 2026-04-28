import { useState, type FormEvent } from 'react'
import { Link, useSearchParams, useNavigate } from 'react-router-dom'
import { requestPasswordReset, resetPassword } from '../api/repApi'
import './auth.css'

export const ResetPasswordPage = () => {
  const navigate = useNavigate()
  const [searchParams] = useSearchParams()
  const token = searchParams.get('token')
  const emailFromUrl = searchParams.get('email')

  const [email, setEmail] = useState(emailFromUrl || '')
  const [newPassword, setNewPassword] = useState('')
  const [confirmPassword, setConfirmPassword] = useState('')
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [success, setSuccess] = useState<string | null>(null)

  const handleRequestReset = async (e: FormEvent) => {
    e.preventDefault()
    setError(null)
    setSuccess(null)

    if (!email.trim()) {
      setError('Email is required')
      return
    }

    try {
      setLoading(true)
      const res = await requestPasswordReset(email.trim().toLowerCase())
      setSuccess(res.message || 'If the email exists, a reset link has been sent.')
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to send reset email')
    } finally {
      setLoading(false)
    }
  }

  const handleResetPassword = async (e: FormEvent) => {
    e.preventDefault()
    setError(null)
    setSuccess(null)

    if (!email.trim() || !token || !newPassword) {
      setError('All fields are required')
      return
    }

    if (newPassword.length < 8) {
      setError('Password must be at least 8 characters long')
      return
    }

    if (newPassword !== confirmPassword) {
      setError('Passwords do not match')
      return
    }

    try {
      setLoading(true)
      const res = await resetPassword(email.trim().toLowerCase(), token, newPassword)
      setSuccess(res.message || 'Password has been reset successfully')
      
      // Redirect to login after 2 seconds
      setTimeout(() => {
        navigate('/')
      }, 2000)
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to reset password')
    } finally {
      setLoading(false)
    }
  }

  return (
    <div className="auth-container">
      <div className="auth-card">
        <h1 className="auth-title">Reset your password</h1>
        <p className="auth-subtitle">
          {token
            ? 'Enter your new password below.'
            : 'Enter the email associated with your Shopify sales rep account.'}
        </p>

        {token ? (
          <form className="auth-form" onSubmit={handleResetPassword}>
            <div className="field">
              <label htmlFor="reset-email">Email</label>
              <input
                id="reset-email"
                type="email"
                required
                placeholder="you@example.com"
                value={email}
                onChange={(e) => setEmail(e.target.value)}
                disabled={loading || !!success}
              />
            </div>

            <div className="field">
              <label htmlFor="new-password">New Password</label>
              <input
                id="new-password"
                type="password"
                required
                placeholder="Enter new password (min 8 characters)"
                value={newPassword}
                onChange={(e) => setNewPassword(e.target.value)}
                disabled={loading || !!success}
                minLength={8}
              />
            </div>

            <div className="field">
              <label htmlFor="confirm-password">Confirm Password</label>
              <input
                id="confirm-password"
                type="password"
                required
                placeholder="Confirm new password"
                value={confirmPassword}
                onChange={(e) => setConfirmPassword(e.target.value)}
                disabled={loading || !!success}
                minLength={8}
              />
            </div>

            <button type="submit" className="primary-button" disabled={loading || !!success}>
              {loading ? 'Resetting...' : success ? 'Redirecting...' : 'Reset Password'}
            </button>

            {error && <p className="auth-message auth-error">{error}</p>}
            {success && <p className="auth-message auth-success">{success}</p>}

            <div className="auth-footer">
              <Link to="/">Back to login</Link>
            </div>
          </form>
        ) : (
          <form className="auth-form" onSubmit={handleRequestReset}>
            <div className="field">
              <label htmlFor="email">Email</label>
              <input
                id="email"
                type="email"
                required
                placeholder="you@example.com"
                value={email}
                onChange={(e) => setEmail(e.target.value)}
                disabled={loading}
              />
            </div>

            <button type="submit" className="primary-button" disabled={loading}>
              {loading ? 'Sending...' : 'Send reset link'}
            </button>

            {error && <p className="auth-message auth-error">{error}</p>}
            {success && <p className="auth-message auth-success">{success}</p>}

            <div className="auth-footer">
              <Link to="/">Back to login</Link>
            </div>
          </form>
        )}
      </div>
    </div>
  )
}

