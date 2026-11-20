import { cookies } from "next/headers";
import { NextResponse } from "next/server";
import { ADMIN_SESSION_COOKIE, hasValidAdminSession } from "../../../../lib/admin-auth";
import { prisma } from "../../../../lib/prisma";
import { orderToSalesApi } from "../../../../lib/sales-orders";

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
    const [todaySales, recentSales, products, onlineOrders] = await Promise.all([
      prisma.salesTransaction.aggregate({
        where: { createdAt: { gte: startOfDay } },
        _count: { _all: true },
        _sum: { subtotal: true },
      }),
      prisma.salesTransaction.findMany({ orderBy: { createdAt: "desc" } }),
      prisma.product.findMany({
        orderBy: [{ category: "asc" }, { name: "asc" }],
        select: { id: true, name: true, category: true, size: true, sizePrices: true, price: true, stockQuantity: true, image: true },
      }),
      prisma.order.findMany({
        where: { status: { not: "awaiting_payment" } },
        orderBy: { createdAt: "desc" },
        select: {
          id: true,
          status: true,
          paymentMethod: true,
          items: true,
          subtotal: true,
          shipping: true,
          total: true,
          customerName: true,
          phone: true,
          shippingAddress: true,
          createdAt: true,
        },
      }),
    ]);
    const sales = recentSales.map((sale) => ({
      id: sale.id,
      salesperson: sale.salesperson,
      payment_method: sale.paymentMethod,
      items: sale.items,
      subtotal: Number(sale.subtotal),
      created_at: sale.createdAt.toISOString(),
    }));
    return NextResponse.json({
      today: {
        count: todaySales._count._all,
        revenue: Number(todaySales._sum.subtotal || 0),
      },
      sales,
      recentSales: sales.slice(0, 20),
      products: products.map((product) => ({ ...product, price: Number(product.price) })),
      onlineOrders: onlineOrders.map(orderToSalesApi),
      lowStockCount: products.filter((product) => product.stockQuantity <= 5).length,
      totalStockQuantity: products.reduce((total, product) => total + product.stockQuantity, 0),
    });
  } catch (error) {
    console.error("Admin could not load in-store sales:", error);
    return NextResponse.json({ error: "Could not load in-store sales from the database." }, { status: 503 });
  }
}
