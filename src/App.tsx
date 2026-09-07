import { Navigate, Route, Routes, useLocation } from 'react-router'
import { Toaster } from 'sonner'
import Landing from './pages/Landing'
import Login from './pages/Login'
import Forgot from './pages/Forgot'
import Reset from './pages/Reset'
import ChangePassword from './pages/ChangePassword'
import Portal from './portal/Portal'
import { StoreProvider, useStore } from './lib/store'

/** Signed-in only; accounts flagged `mustChangePassword` are held on the change-password page until they set one. */
function Guard({ children }: { children: React.ReactNode }) {
  const { user } = useStore()
  const loc = useLocation()
  if (!user) return <Navigate to="/login" state={{ from: loc.pathname }} replace />
  if (user.mustChangePassword && loc.pathname !== '/change-password') return <Navigate to="/change-password" replace />
  return <>{children}</>
}

function LoggedInRedirect({ children }: { children: React.ReactNode }) {
  const { user } = useStore()
  if (user) return <Navigate to={user.mustChangePassword ? '/change-password' : '/portal'} replace />
  return <>{children}</>
}

export default function App() {
  return (
    <StoreProvider>
      <Toaster position="bottom-right" richColors closeButton />
      <Routes>
        <Route path="/" element={<Landing />} />
        <Route path="/login" element={<LoggedInRedirect><Login /></LoggedInRedirect>} />
        <Route path="/forgot" element={<LoggedInRedirect><Forgot /></LoggedInRedirect>} />
        <Route path="/reset" element={<LoggedInRedirect><Reset /></LoggedInRedirect>} />
        <Route path="/change-password" element={<Guard><ChangePassword /></Guard>} />
        <Route path="/portal" element={<Guard><Portal /></Guard>} />
        <Route path="*" element={<Navigate to="/" replace />} />
      </Routes>
    </StoreProvider>
  )
}
