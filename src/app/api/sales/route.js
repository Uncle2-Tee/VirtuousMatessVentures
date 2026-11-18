import { cookies } from "next/headers";
import { NextResponse } from "next/server";
import { InsufficientStockError, reserveProductStock } from "../../../lib/inventory";
import { isTransientDatabaseError } from "../../../lib/database-retry";
import { prisma } from "../../../lib/prisma";
import { SALES_SESSION_COOKIE, getSalesSessionUsername } from "../../../lib/sales-auth";

export const runtime = "nodejs";

const paymentMethods = new Set(["cash", "mobile_money", "card"]);
const MAX_SALE_TOTAL_CENTS = 9_999_999_999;

class SaleAmountLimitError extends Error {}

function salesTransactionToApi(sale) {
  return {
    id: sale.id,
    salesperson: sale.salesperson,
    payment_method: sale.paymentMethod,
    items: sale.items,
    subtotal: Number(sale.subtotal),
    created_at: sale.createdAt.toISOString(),
  };
}

async function getSalesperson() {
  const cookieStore = await cookies();
  return getSalesSessionUsername(cookieStore.get(SALES_SESSION_COOKIE)?.value);
}

function databaseUnavailable() {
  return NextResponse.json({ error: "The PostgreSQL database is not configured." }, { status: 503 });
}

export async function GET() {
  const salesperson = await getSalesperson();
  if (!salesperson) return NextResponse.json({ error: "Salesperson sign-in required." }, { status: 401 });
  if (!process.env.DATABASE_URL) return databaseUnavailable();

  try {
    const startOfDay = new Date();
    startOfDay.setUTCHours(0, 0, 0, 0);
    const [products, todaySales, recentSales] = await Promise.all([
      prisma.product.findMany({
        orderBy: [{ category: "asc" }, { name: "asc" }],
        select: { id: true, name: true, category: true, size: true, price: true, stockQuantity: true, image: true },
      }),
      prisma.salesTransaction.aggregate({
        where: { createdAt: { gte: startOfDay } },
        _count: { _all: true },
        _sum: { subtotal: true },
      }),
      prisma.salesTransaction.findMany({ orderBy: { createdAt: "desc" }, take: 20 }),
    ]);

    return NextResponse.json({
      products: products.map((product) => ({ ...product, price: Number(product.price) })),
      today: {
        count: todaySales._count._all,
        revenue: Number(todaySales._sum.subtotal || 0),
      },
      recentSales: recentSales.map(salesTransactionToApi),
      lowStockCount: products.filter((product) => product.stockQuantity <= 5).length,
    });
  } catch (error) {
    console.error("Salesperson could not load the sales dashboard:", error);
    return NextResponse.json({ error: "Could not load sales and inventory from the database." }, { status: 503 });
  }
}

export async function POST(request) {
  const salesperson = await getSalesperson();
  if (!salesperson) return NextResponse.json({ error: "Salesperson sign-in required." }, { status: 401 });
  if (!process.env.DATABASE_URL) return databaseUnavailable();

  let items;
  let paymentMethod;
  try {
    ({ items, paymentMethod } = await request.json());
  } catch {
    return NextResponse.json({ error: "Invalid sale details." }, { status: 400 });
  }

  if (!Array.isArray(items) || items.length < 1 || items.length > 50
    || items.some((item) => typeof item?.productId !== "string"
      || !item.productId
      || !Number.isSafeInteger(item.quantity)
      || item.quantity < 1
      || item.quantity > 1000)
    || !paymentMethods.has(paymentMethod)) {
    return NextResponse.json({ error: "Add valid products, quantities, and a payment method before recording the sale." }, { status: 400 });
  }

  const quantities = new Map();
  for (const item of items) {
    const quantity = (quantities.get(item.productId) || 0) + item.quantity;
    if (!Number.isSafeInteger(quantity) || quantity > 1000) {
      return NextResponse.json({ error: "A product quantity cannot exceed 1,000 units per sale." }, { status: 400 });
    }
    quantities.set(item.productId, quantity);
  }

  try {
    const sale = await prisma.$transaction(async (database) => {
      const productIds = [...quantities.keys()].sort();
      const products = await database.product.findMany({
        where: { id: { in: productIds } },
        select: { id: true, name: true, size: true, price: true },
      });
      if (products.length !== productIds.length) {
        throw new InsufficientStockError("A selected product", 0);
      }

      const reservedItems = productIds.map((productId) => ({ productId, quantity: quantities.get(productId) }));
      await reserveProductStock(database, reservedItems);

      let totalCents = 0;
      const saleItems = products.map((product) => {
        const quantity = quantities.get(product.id);
        const priceCents = Math.round(Number(product.price) * 100);
        const lineTotalCents = priceCents * quantity;
        totalCents += lineTotalCents;
        return {
          product_id: product.id,
          name: product.name,
          size: product.size,
          price: (priceCents / 100).toFixed(2),
          quantity,
          line_total: (lineTotalCents / 100).toFixed(2),
        };
      });
      if (!Number.isSafeInteger(totalCents) || totalCents > MAX_SALE_TOTAL_CENTS) {
        throw new SaleAmountLimitError("The sale total exceeds the supported amount.");
      }

      return database.salesTransaction.create({
        data: {
          salesperson,
          paymentMethod,
          items: saleItems,
          subtotal: (totalCents / 100).toFixed(2),
        },
      });
    });

    return NextResponse.json({ sale: salesTransactionToApi(sale) }, { status: 201 });
  } catch (error) {
    if (error instanceof InsufficientStockError) {
      return NextResponse.json({ error: error.message }, { status: 409 });
    }
    if (error instanceof SaleAmountLimitError) {
      return NextResponse.json({ error: error.message }, { status: 400 });
    }
    console.error("Salesperson could not record a sale:", error);
    if (isTransientDatabaseError(error)) {
      return NextResponse.json({ error: "The sales database is temporarily unavailable. Check Recent sales before retrying." }, { status: 503 });
    }
    if (error?.code === "P2021" || error?.code === "P2022") {
      return NextResponse.json({ error: "Sales cannot be recorded because the database schema is out of date. Contact the administrator." }, { status: 503 });
    }
    return NextResponse.json({ error: "Could not confirm the sale. Check Recent sales before retrying." }, { status: 503 });
  }
}
