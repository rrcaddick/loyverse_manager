/** /request → the first screen of the stepped form (query string kept). */

import { Navigate, useLocation } from "react-router";

export default function RequestPage() {
  const { search, hash } = useLocation();
  return <Navigate to={`/request/visit${search}${hash}`} replace />;
}
