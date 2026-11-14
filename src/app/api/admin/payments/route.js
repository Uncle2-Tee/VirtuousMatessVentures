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

  try {
    const attempts = await prisma.paymentAttempt.findMany({
      where: {
        status: "successful",
        orderId: { not: null },
      },
      orderBy: { updatedAt: "desc" },
      take: 50,
      select: {
        reference: true,
        amount: true,
        currency: true,
        updatedAt: true,
        order: {
          select: {
            id: true,
            customerName: true,
            customerEmail: true,
            items: true,
          },
        },
      },
    });

    const receipts = attempts.flatMap((attempt) => attempt.order ? [{
      reference: attempt.reference,
      amount: attempt.amount / 100,
      currency: attempt.currency,
      paid_at: attempt.updatedAt.toISOString(),
      order_id: attempt.order.id,
      customer_name: attempt.order.customerName,
      customer_email: attempt.order.customerEmail,
      items: attempt.order.items,
    }] : []);

    return NextResponse.json({ receipts }, {
      headers: { "Cache-Control": "private, no-store" },
    });
  } catch (error) {
    console.error("Admin could not load payment receipts:", error);
    return NextResponse.json({ error: "Could not load payment receipts from the database." }, { status: 503 });
  }
}
