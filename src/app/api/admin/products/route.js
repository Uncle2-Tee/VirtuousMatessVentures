import { cookies } from "next/headers";
import { randomUUID } from "node:crypto";
import { NextResponse } from "next/server";
import { ADMIN_SESSION_COOKIE, hasValidAdminSession } from "../../../../lib/admin-auth";
import { activeProductCategories, productCategories } from "../../../../lib/catalog";
import { isTransientDatabaseError, withDatabaseRetry } from "../../../../lib/database-retry";
import { prisma } from "../../../../lib/prisma";
import { MAX_PRODUCT_PRICE, productFromDatabaseRow, productToDatabaseRow, validProduct } from "../../../../lib/products";

export const runtime = "nodejs";

async function requireAdmin() {
  const cookieStore = await cookies();
  return hasValidAdminSession(cookieStore.get(ADMIN_SESSION_COOKIE)?.value);
}

async function isActiveCategory(name) {
  const normalizedName = name.trim().replace(/\s+/g, " ").toLowerCase();
  const savedCategory = await prisma.productCategory.findUnique({
    where: { normalizedName },
    select: { isActive: true },
  });
  if (savedCategory) return savedCategory.isActive;
  return productCategories.some((category) => category.toLowerCase() === normalizedName);
}

function databaseUnavailable() {
  return NextResponse.json({ error: "The PostgreSQL database is not configured." }, { status: 503 });
}

export async function GET() {
  if (!(await requireAdmin())) return NextResponse.json({ error: "Admin sign-in required." }, { status: 401 });
  if (!process.env.DATABASE_URL) return databaseUnavailable();
  try {
    const [products, savedCategories] = await Promise.all([
      prisma.product.findMany({ orderBy: { sortOrder: "asc" } }),
      prisma.productCategory.findMany({
        orderBy: { createdAt: "asc" },
        select: { name: true, normalizedName: true, isActive: true },
      }),
    ]);
    return NextResponse.json({
      products: products.map(productFromDatabaseRow),
      categories: activeProductCategories(savedCategories, products.map((product) => product.category)),
    });
  } catch (error) {
    console.error("Admin could not read product catalogue:", error);
    return NextResponse.json({ error: "Could not load products from the database." }, { status: 503 });
  }
}

export async function POST(request) {
  if (!(await requireAdmin())) return NextResponse.json({ error: "Admin sign-in required." }, { status: 401 });
  if (!process.env.DATABASE_URL) return databaseUnavailable();
  let product;
  try {
    ({ product } = await request.json());
  } catch {
    return NextResponse.json({ error: "Invalid product data." }, { status: 400 });
  }
  if (Number.isFinite(Number(product?.price)) && Number(product.price) > MAX_PRODUCT_PRICE) {
    return NextResponse.json({ error: `Price must not exceed GHS ${MAX_PRODUCT_PRICE.toLocaleString("en-GH", { minimumFractionDigits: 2 })}.` }, { status: 400 });
  }
  if (!validProduct(product)) return NextResponse.json({ error: "Complete all required product fields with a valid price and stock quantity." }, { status: 400 });

  try {
    if (!(await withDatabaseRetry(() => isActiveCategory(product.category)))) {
      return NextResponse.json({ error: "Choose an active product category." }, { status: 400 });
    }
    const first = await withDatabaseRetry(() =>
      prisma.product.findFirst({ orderBy: { sortOrder: "asc" }, select: { sortOrder: true } }));
    const sortOrder = first ? Math.max(first.sortOrder - 1, -2_147_483_648) : -1;
    const data = productToDatabaseRow({ ...product, sortOrder });
    const saved = await withDatabaseRetry(() => prisma.product.upsert({
      where: { id: data.id },
      create: data,
      update: { id: data.id },
    }));
    return NextResponse.json({ product: productFromDatabaseRow(saved) }, { status: 201 });
  } catch (error) {
    console.error("Admin could not create product:", error);
    if (error?.code === "P2002") {
      return NextResponse.json({ error: "This product ID is already in use. Please try publishing again." }, { status: 409 });
    }
    if (error?.code === "P2000" || error?.code === "P2020") {
      return NextResponse.json({ error: "One or more product details exceed the database's supported limits." }, { status: 400 });
    }
    if (isTransientDatabaseError(error)) {
      return NextResponse.json({ error: "The database is temporarily unavailable. Your product was not confirmed; please try again." }, { status: 503 });
    }
    return NextResponse.json({ error: "Could not save the product to the database." }, { status: 500 });
  }
}

export async function PATCH(request) {
  if (!(await requireAdmin())) return NextResponse.json({ error: "Admin sign-in required." }, { status: 401 });
  if (!process.env.DATABASE_URL) return databaseUnavailable();
  let id;
  let changes;
  try {
    ({ id, ...changes } = await request.json());
  } catch {
    return NextResponse.json({ error: "Invalid product update." }, { status: 400 });
  }
  if (typeof id !== "string" || !id || Object.keys(changes).length === 0) {
    return NextResponse.json({ error: "A product and at least one change are required." }, { status: 400 });
  }
  const update = { updatedAt: new Date() };
  if (Object.hasOwn(changes, "name")) {
    if (typeof changes.name !== "string" || !changes.name.trim() || changes.name.trim().length > 200) {
      return NextResponse.json({ error: "Product name must be between 1 and 200 characters." }, { status: 400 });
    }
    update.name = changes.name.trim();
  }
  if (Object.hasOwn(changes, "price")) {
    const price = Number(changes.price);
    if (!Number.isFinite(price) || price <= 0) return NextResponse.json({ error: "Price must be greater than zero." }, { status: 400 });
    update.price = price;
  }
  if (Object.hasOwn(changes, "stockQuantity")) {
    if (!Number.isSafeInteger(changes.stockQuantity) || changes.stockQuantity < 0 || changes.stockQuantity > 2_147_483_647) {
      return NextResponse.json({ error: "Stock quantity must be a whole number between 0 and 2,147,483,647." }, { status: 400 });
    }
    update.stockQuantity = changes.stockQuantity;
  }
  if (Object.hasOwn(changes, "category")) {
    if (typeof changes.category !== "string" || !changes.category.trim() || changes.category.trim().length > 50) {
      return NextResponse.json({ error: "Product category must be between 1 and 50 characters." }, { status: 400 });
    }
    if (changes.category.trim().toLowerCase() === "all") {
      return NextResponse.json({ error: "\"All\" is reserved for the unfiltered category view." }, { status: 400 });
    }
    update.category = changes.category.trim().replace(/\s+/g, " ");
    if (!(await isActiveCategory(update.category))) {
      return NextResponse.json({ error: "Choose an active product category." }, { status: 400 });
    }
  }
  if (Object.hasOwn(changes, "cardDescription")) {
    if (typeof changes.cardDescription !== "string") return NextResponse.json({ error: "The featured description must be text." }, { status: 400 });
    update.cardDescription = changes.cardDescription;
  }
  if (Object.keys(changes).some((key) => key !== "name" && key !== "price" && key !== "stockQuantity" && key !== "category" && key !== "cardDescription")) {
    return NextResponse.json({ error: "Unsupported product fields." }, { status: 400 });
  }

  try {
    const saved = await prisma.product.update({ where: { id }, data: update });
    return NextResponse.json({ product: productFromDatabaseRow(saved) });
  } catch (error) {
    if (error.code === "P2025") return NextResponse.json({ error: "Product was not found." }, { status: 404 });
    console.error("Admin could not update product:", error);
    return NextResponse.json({ error: "Could not update the product in the database." }, { status: 500 });
  }
}

export async function DELETE(request) {
  if (!(await requireAdmin())) return NextResponse.json({ error: "Admin sign-in required." }, { status: 401 });
  if (!process.env.DATABASE_URL) return databaseUnavailable();
  const id = new URL(request.url).searchParams.get("id");
  if (!id) return NextResponse.json({ error: "A product ID is required." }, { status: 400 });
  try {
    await prisma.product.delete({ where: { id } });
    return NextResponse.json({ ok: true });
  } catch (error) {
    if (error.code === "P2025") return NextResponse.json({ error: "Product was not found." }, { status: 404 });
    console.error("Admin could not remove product:", error);
    return NextResponse.json({ error: "Could not remove the product from the database." }, { status: 500 });
  }
}
