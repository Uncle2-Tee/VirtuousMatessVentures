import { NextResponse } from "next/server";
import { activeProductCategories, initialProducts, mergeProductCategories, productCategories } from "../../../lib/catalog";
import { isTransientDatabaseError, withDatabaseRetry } from "../../../lib/database-retry";
import { processExpiredInventoryReservations } from "../../../lib/paystack-payments";
import { prisma } from "../../../lib/prisma";
import { productFromDatabaseRow } from "../../../lib/products";

export const runtime = "nodejs";

async function findCatalogueWithRetry() {
  return withDatabaseRetry(async () => {
    await processExpiredInventoryReservations();
    const products = await prisma.product.findMany({ orderBy: { sortOrder: "asc" } });
    const savedCategories = await prisma.productCategory.findMany({
      orderBy: { createdAt: "asc" },
      select: { name: true, normalizedName: true, isActive: true },
    });
    return { products, savedCategories };
  });
}

export async function GET() {
  if (!process.env.DATABASE_URL) {
    if (process.env.NODE_ENV === "development") {
      return NextResponse.json({
        products: initialProducts,
        categories: mergeProductCategories(productCategories, initialProducts.map((product) => product.category)),
      });
    }

    return NextResponse.json(
      { error: "PostgreSQL is not configured. Set DATABASE_URL in .env.local, apply the Prisma schema, and seed the product catalogue." },
      { status: 503 },
    );
  }

  try {
    const { products, savedCategories } = await findCatalogueWithRetry();
    return NextResponse.json({
      products: products.map(productFromDatabaseRow),
      categories: activeProductCategories(savedCategories, products.map((product) => product.category)),
    });
  } catch (error) {
    console.error("Could not read the product catalogue:", error);
    if (process.env.NODE_ENV === "development" && isTransientDatabaseError(error)) {
      console.warn("Using the local starter catalogue while PostgreSQL is unavailable.");
      return NextResponse.json({
        products: initialProducts,
        categories: mergeProductCategories(productCategories, initialProducts.map((product) => product.category)),
      });
    }
    return NextResponse.json({ error: "Could not load products from the PostgreSQL database." }, { status: 503 });
  }
}
