import { cookies } from "next/headers";
import { NextResponse } from "next/server";
import { ADMIN_SESSION_COOKIE, hasValidAdminSession } from "../../../../lib/admin-auth";
import { prisma } from "../../../../lib/prisma";

export const runtime = "nodejs";

export async function GET() {
  const cookieStore = await cookies();
  if (!(await hasValidAdminSession(cookieStore.get(ADMIN_SESSION_COOKIE)?.value))) {
    return NextResponse.json({ error: "Admin sign-in required." }, { status: 401 });
  }
  if (!process.env.DATABASE_URL) {
    return NextResponse.json({ error: "The PostgreSQL database is not configured." }, { status: 503 });
  }

  try {
    const startOfDay = new Date();
    startOfDay.setUTCHours(0, 0, 0, 0);
    const [todaySales, recentSales] = await Promise.all([
      prisma.salesTransaction.aggregate({
        where: { createdAt: { gte: startOfDay } },
        _count: { _all: true },
        _sum: { subtotal: true },
      }),
      prisma.salesTransaction.findMany({ orderBy: { createdAt: "desc" }, take: 25 }),
    ]);
    return NextResponse.json({
      today: {
        count: todaySales._count._all,
        revenue: Number(todaySales._sum.subtotal || 0),
      },
      sales: recentSales.map((sale) => ({
        id: sale.id,
        salesperson: sale.salesperson,
        payment_method: sale.paymentMethod,
        items: sale.items,
        subtotal: Number(sale.subtotal),
        created_at: sale.createdAt.toISOString(),
      })),
    });
  } catch (error) {
    console.error("Admin could not load in-store sales:", error);
    return NextResponse.json({ error: "Could not load in-store sales from the database." }, { status: 503 });
  }
}
