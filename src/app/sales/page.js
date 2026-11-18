import { cookies } from "next/headers";
import { SALES_SESSION_COOKIE, getSalesSessionUsername, isSalesAuthConfigured } from "../../lib/sales-auth";
import SalesDashboard from "./sales-dashboard";
import SalesLogin from "./sales-login";
import "./sales.css";

export const metadata = {
  title: "Sales Desk | Virtuous Matess Ventures",
  robots: { index: false, follow: false },
};

export default async function SalesPage() {
  const cookieStore = await cookies();
  const username = getSalesSessionUsername(cookieStore.get(SALES_SESSION_COOKIE)?.value);

  return username
    ? <SalesDashboard username={username} />
    : <SalesLogin configured={isSalesAuthConfigured()} />;
}
