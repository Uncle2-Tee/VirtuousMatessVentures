import { cookies } from "next/headers";
import { NextResponse } from "next/server";
import { ADMIN_SESSION_COOKIE, hasValidAdminSession } from "../../../../lib/admin-auth";
import { normalizeProductCategoryName, productCategories } from "../../../../lib/catalog";
import { prisma } from "../../../../lib/prisma";

export const runtime = "nodejs";

async function requireAdmin() {
  const cookieStore = await cookies();
  return hasValidAdminSession(cookieStore.get(ADMIN_SESSION_COOKIE)?.value);
}

export async function POST(request) {
  if (!(await requireAdmin())) return NextResponse.json({ error: "Admin sign-in required." }, { status: 401 });
  if (!process.env.DATABASE_URL) return NextResponse.json({ error: "The PostgreSQL database is not configured." }, { status: 503 });

  let name;
  try {
    const body = await request.json();
    name = normalizeProductCategoryName(body?.name);
  } catch {
    return NextResponse.json({ error: "Invalid category data." }, { status: 400 });
  }

  if (!name || name.length > 50) {
    return NextResponse.json({ error: "Category names must be between 1 and 50 characters." }, { status: 400 });
  }
  if (name.toLowerCase() === "all") {
    return NextResponse.json({ error: "\"All\" is reserved for the unfiltered category view." }, { status: 409 });
  }
  try {
    const existingCategory = await prisma.productCategory.findUnique({
      where: { normalizedName: name.toLowerCase() },
      select: { name: true, isActive: true },
    });
    if (existingCategory?.isActive || (!existingCategory && productCategories.some((category) => category.toLowerCase() === name.toLowerCase()))) {
      return NextResponse.json({ error: "That category already exists." }, { status: 409 });
    }
    if (existingCategory) {
      const restoredCategory = await prisma.productCategory.update({
        where: { normalizedName: name.toLowerCase() },
        data: { isActive: true },
        select: { name: true },
      });
      return NextResponse.json({ category: restoredCategory.name, restored: true });
    }

    const category = await prisma.productCategory.create({
      data: { name, normalizedName: name.toLowerCase(), isActive: true },
      select: { name: true },
    });
    return NextResponse.json({ category: category.name }, { status: 201 });
  } catch (error) {
    if (error?.code === "P2002") return NextResponse.json({ error: "That category already exists." }, { status: 409 });
    console.error("Admin could not create product category:", error);
    return NextResponse.json({ error: "Could not save the category." }, { status: 500 });
  }
}

export async function DELETE(request) {
  if (!(await requireAdmin())) return NextResponse.json({ error: "Admin sign-in required." }, { status: 401 });
  if (!process.env.DATABASE_URL) return NextResponse.json({ error: "The PostgreSQL database is not configured." }, { status: 503 });

  let name;
  let replacementCategory;
  let hasReplacementCategory = false;
  try {
    const body = await request.json();
    name = normalizeProductCategoryName(body?.name);
    hasReplacementCategory = Object.hasOwn(body ?? {}, "replacementCategory");
    replacementCategory = normalizeProductCategoryName(body?.replacementCategory);
  } catch {
    return NextResponse.json({ error: "Invalid category data." }, { status: 400 });
  }

  if (!name || name.length > 50) {
    return NextResponse.json({ error: "Category names must be between 1 and 50 characters." }, { status: 400 });
  }
  if (name.toLowerCase() === "all") {
    return NextResponse.json({ error: "\"All\" is reserved for the unfiltered category view." }, { status: 409 });
  }
  if (hasReplacementCategory && (!replacementCategory || replacementCategory.length > 50 || replacementCategory.toLowerCase() === "all")) {
    return NextResponse.json({ error: "Choose a valid destination category." }, { status: 400 });
  }

  try {
    const result = await prisma.$transaction(async (transaction) => {
      const category = await transaction.productCategory.findUnique({
        where: { normalizedName: name.toLowerCase() },
        select: { name: true, isActive: true },
      });
      const defaultName = productCategories.find((item) => item.toLowerCase() === name.toLowerCase());
      if ((!category && !defaultName) || (category && !category.isActive)) {
        return { status: 404, error: "Category was not found." };
      }

      const categoryName = category?.name || defaultName;
      const productCount = await transaction.product.count({
        where: { category: { equals: categoryName, mode: "insensitive" } },
      });
      let movedProducts = 0;
      let destinationName = "";

      if (productCount > 0) {
        if (!hasReplacementCategory) {
          return {
            status: 409,
            error: `${categoryName} is used by ${productCount} ${productCount === 1 ? "product" : "products"}. Choose a destination category.`,
          };
        }

        const destination = await transaction.productCategory.findUnique({
          where: { normalizedName: replacementCategory.toLowerCase() },
          select: { name: true, isActive: true },
        });
        const defaultDestination = productCategories.find((item) => item.toLowerCase() === replacementCategory.toLowerCase());
        if ((!destination && !defaultDestination) || (destination && !destination.isActive)) {
          return { status: 409, error: "Choose an active destination category." };
        }
        destinationName = destination?.name || defaultDestination;
        if (destinationName.toLowerCase() === categoryName.toLowerCase()) {
          return { status: 409, error: "Choose a different destination category." };
        }

        const moveResult = await transaction.product.updateMany({
          where: { category: { equals: categoryName, mode: "insensitive" } },
          data: { category: destinationName, updatedAt: new Date() },
        });
        movedProducts = moveResult.count;
      }

      if (category) {
        await transaction.productCategory.update({
          where: { normalizedName: name.toLowerCase() },
          data: { isActive: false },
        });
      } else {
        await transaction.productCategory.create({
          data: { name: categoryName, normalizedName: categoryName.toLowerCase(), isActive: false },
        });
      }
      return { category: categoryName, movedProducts, replacementCategory: destinationName, ok: true };
    });

    if (result.status) return NextResponse.json({ error: result.error }, { status: result.status });
    return NextResponse.json(result);
  } catch (error) {
    if (error?.code === "P2025") return NextResponse.json({ error: "Category was not found." }, { status: 404 });
    console.error("Admin could not remove product category:", error);
    return NextResponse.json({ error: "Could not remove the category." }, { status: 500 });
  }
}
