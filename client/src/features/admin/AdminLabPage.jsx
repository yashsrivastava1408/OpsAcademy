import { Navigate } from 'react-router-dom';

/** The old Lab administration page now lives in the admin dashboard; this keeps old links working. */
export default function AdminLabPage() {
  return <Navigate to="/admin?tab=lab-accounts" replace />;
}
