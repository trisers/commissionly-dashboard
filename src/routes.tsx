import { createBrowserRouter } from 'react-router-dom'
import { LoginPage } from './screens/LoginPage'
import { ResetPasswordPage } from './screens/ResetPasswordPage'
import { DashboardPage } from './screens/DashboardPage'

export const router = createBrowserRouter([
  {
    path: '/',
    element: <LoginPage />,
  },
  {
    path: '/reset-password',
    element: <ResetPasswordPage />,
  },
  {
    path: '/dashboard',
    element: <DashboardPage />,
  },
  {
    path: '/dashboard/orders',
    element: <DashboardPage />,
  },
  {
    path: '/dashboard/profile',
    element: <DashboardPage />,
  },
])

