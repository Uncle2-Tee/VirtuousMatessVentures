import { cookies } from "next/headers";
import { ADMIN_SESSION_COOKIE, getAdminSessionUsername, hasValidAdminSession } from "../../lib/admin-auth";
import { SALES_SESSION_COOKIE, getSalesSessionUsername, isSalesAuthConfigured } from "../../lib/sales-auth";
import SalesDashboard from "./sales-dashboard";
import SalesLogin from "./sales-login";
import "./sales.css";

export const metadata = {
  title: "Sales Desk | Virtuous Matess Ventures",
  robots: { index: false, follow: false },
};

export default async function SalesPage({ searchParams }) {
  const cookieStore = await cookies();
  const username = await getSalesSessionUsername(cookieStore.get(SALES_SESSION_COOKIE)?.value);
  const adminSession = cookieStore.get(ADMIN_SESSION_COOKIE)?.value;
  const isAdmin = await hasValidAdminSession(adminSession);
  const { from } = await searchParams;
  const showAdminReturn = isAdmin && from === "admin";

  if (showAdminReturn) {
    return <SalesDashboard username={getAdminSessionUsername(adminSession)} showAdminReturn readOnly />;
  }

  if (username) return <SalesDashboard username={username} />;
  return <SalesLogin configured={await isSalesAuthConfigured()} />;
}
