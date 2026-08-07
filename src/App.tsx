import { Navigate, Route, Routes, useLocation } from 'react-router'
import { Toaster } from 'sonner'
import Landing from './pages/Landing'
import Login from './pages/Login'
import Portal from './portal/Portal'
import { StoreProvider, useStore } from './lib/store'

function Guard({ children }: { children: React.ReactNode }) {
  const { user } = useStore()
  const loc = useLocation()
  if (!user) return <Navigate to="/login" state={{ from: loc.pathname }} replace />
  return <>{children}</>
}

export default function App() {
  return (
    <StoreProvider>
      <Toaster position="bottom-right" richColors closeButton />
      <Routes>
        <Route path="/" element={<Landing />} />
        <Route path="/login" element={<Login />} />
        <Route path="/portal" element={<Guard><Portal /></Guard>} />
        <Route path="*" element={<Navigate to="/" replace />} />
      </Routes>
    </StoreProvider>
  )
}
