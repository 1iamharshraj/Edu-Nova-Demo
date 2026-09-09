import { Navigate, Route, Routes, useLocation } from 'react-router'
import { Toaster } from 'sonner'
import Landing from './pages/Landing'
import Login from './pages/Login'
import Forgot from './pages/Forgot'
import Reset from './pages/Reset'
import ChangePassword from './pages/ChangePassword'
import Portal from './portal/Portal'
import { StoreProvider, useStore } from './lib/store'
import EmployeeDetail from './pages/portal/EmployeeDetail'
import SubjectChapters from './pages/portal/SubjectChapters'
import ClassSubjects from './pages/portal/ClassSubjects'
import ClassRoster from './pages/portal/ClassRoster'
import BookDetail from './pages/portal/BookDetail'
import ItemDetail from './pages/portal/ItemDetail'
import PODetail from './pages/portal/PODetail'
import StudentReport from './pages/portal/StudentReport'
import FeeStructureDetail from './pages/portal/FeeStructureDetail'
import ContractDetail from './pages/portal/ContractDetail'
import JournalEntryNew from './pages/portal/JournalEntryNew'
import JournalEntryDetail from './pages/portal/JournalEntryDetail'
import ReviewNew from './pages/portal/ReviewNew'
import ReviewDetail from './pages/portal/ReviewDetail'
import SchoolDetail from './pages/portal/SchoolDetail'
import AdmissionNew from './pages/portal/AdmissionNew'
import PersonEditor from './pages/portal/PersonEditor'
import BoardRegistrationEdit from './pages/portal/BoardRegistrationEdit'
import ActivityRegistrations from './pages/portal/ActivityRegistrations'
import PurchaseOrderNew from './pages/portal/PurchaseOrderNew'
import AlumniProfileEditor from './pages/portal/AlumniProfileEditor'
import AlumniEventRsvps from './pages/portal/AlumniEventRsvps'
import FeeDefaulterCallLog from './pages/portal/FeeDefaulterCallLog'
import DisciplinaryCaseDetail from './pages/portal/DisciplinaryCaseDetail'
import StudentPortfolio from './pages/portal/StudentPortfolio'
import HousePointsLedger from './pages/portal/HousePointsLedger'

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
        <Route path="/portal/employees/:id" element={<Guard><EmployeeDetail /></Guard>} />
        <Route path="/portal/academic/subjects/:id/chapters" element={<Guard><SubjectChapters /></Guard>} />
        <Route path="/portal/academic/classes/:id/subjects" element={<Guard><ClassSubjects /></Guard>} />
        <Route path="/portal/academic/classes/:id/roster" element={<Guard><ClassRoster /></Guard>} />
        <Route path="/portal/library/books/:id" element={<Guard><BookDetail /></Guard>} />
        <Route path="/portal/inventory/items/:id" element={<Guard><ItemDetail /></Guard>} />
        <Route path="/portal/inventory/purchase-orders/new" element={<Guard><PurchaseOrderNew /></Guard>} />
        <Route path="/portal/inventory/purchase-orders/:id" element={<Guard><PODetail /></Guard>} />
        <Route path="/portal/students/:id/report" element={<Guard><StudentReport /></Guard>} />
        <Route path="/portal/students/:id/board-registration" element={<Guard><BoardRegistrationEdit /></Guard>} />
        <Route path="/portal/students/:id/portfolio" element={<Guard><StudentPortfolio /></Guard>} />
        <Route path="/portal/finance/fee-structures/:classId/:termId" element={<Guard><FeeStructureDetail /></Guard>} />
        <Route path="/portal/hr/contracts/new" element={<Guard><ContractDetail /></Guard>} />
        <Route path="/portal/hr/contracts/:id" element={<Guard><ContractDetail /></Guard>} />
        <Route path="/portal/accounting/journal/new" element={<Guard><JournalEntryNew /></Guard>} />
        <Route path="/portal/accounting/journal/:id" element={<Guard><JournalEntryDetail /></Guard>} />
        <Route path="/portal/reviews/new" element={<Guard><ReviewNew /></Guard>} />
        <Route path="/portal/reviews/:id" element={<Guard><ReviewDetail /></Guard>} />
        <Route path="/portal/group/schools/:id" element={<Guard><SchoolDetail /></Guard>} />
        <Route path="/portal/admissions/new" element={<Guard><AdmissionNew /></Guard>} />
        <Route path="/portal/people/new" element={<Guard><PersonEditor /></Guard>} />
        <Route path="/portal/people/:id/edit" element={<Guard><PersonEditor /></Guard>} />
        <Route path="/portal/activities/:id/registrations" element={<Guard><ActivityRegistrations /></Guard>} />
        <Route path="/portal/alumni/new" element={<Guard><AlumniProfileEditor /></Guard>} />
        <Route path="/portal/alumni/:id/edit" element={<Guard><AlumniProfileEditor /></Guard>} />
        <Route path="/portal/alumni/events/:id/rsvps" element={<Guard><AlumniEventRsvps /></Guard>} />
        <Route path="/portal/fee-defaulters/:studentId/calls" element={<Guard><FeeDefaulterCallLog /></Guard>} />
        <Route path="/portal/discipline/cases/:id" element={<Guard><DisciplinaryCaseDetail /></Guard>} />
        <Route path="/portal/culture/houses/:id/ledger" element={<Guard><HousePointsLedger /></Guard>} />
        <Route path="*" element={<Navigate to="/" replace />} />
      </Routes>
    </StoreProvider>
  )
}
