import { randomUUID } from "node:crypto";
import { NextResponse } from "next/server";
import { getAuthenticatedUser } from "../../../../lib/customer-auth";
import { failPaymentAttemptAndReleaseStock, InsufficientStockError, reserveProductStock } from "../../../../lib/inventory";
import { prisma } from "../../../../lib/prisma";
import { getPriceForProductSize } from "../../../../lib/products";
import { DELIVERY_FEE } from "../../../../lib/pricing";
import { getPaystackCallbackUrl, getPaystackSecretKey, initializePaystackTransaction } from "../../../../lib/paystack";
import { processExpiredInventoryReservations } from "../../../../lib/paystack-payments";

export const runtime = "nodejs";

export async function POST(request) {
  const user = await getAuthenticatedUser(request);
  if (!user) return NextResponse.json({ error: "Sign in before starting payment." }, { status: 401 });

  let body;
  try {
    body = await request.json();
  } catch {
    return NextResponse.json({ error: "Invalid checkout details." }, { status: 400 });
  }
  const { items, customerName, customerEmail, phone, shippingAddress, city } = body || {};
  if (!Array.isArray(items) || items.length < 1 || items.length > 20
    || items.some((item) => !item || typeof item.productId !== "string" || !item.productId.trim()
      || (item.size !== undefined && (typeof item.size !== "string" || !item.size.trim() || item.size.length > 100))
      || !Number.isInteger(item.quantity) || item.quantity < 1 || item.quantity > 20)
    || new Set(items.map((item) => JSON.stringify([item.productId, item.size || ""]))).size !== items.length
    || typeof customerName !== "string" || customerName.trim().length < 2 || customerName.trim().length > 120
    || typeof customerEmail !== "string" || customerEmail.trim().length > 254 || !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(customerEmail.trim())
    || typeof phone !== "string" || phone.trim().length < 7 || phone.trim().length > 30
    || typeof shippingAddress !== "string" || shippingAddress.trim().length < 8 || shippingAddress.trim().length > 1000
    || typeof city !== "string" || city.trim().length < 2 || city.trim().length > 120) {
    return NextResponse.json({ error: "Provide valid cart, contact, and delivery details." }, { status: 400 });
  }

  try {
    getPaystackSecretKey();
  } catch {
    return NextResponse.json({ error: "Paystack is not configured for payments." }, { status: 503 });
  }

  try {
    await processExpiredInventoryReservations();
    const productIds = [...new Set(items.map((item) => item.productId))];
    const products = await prisma.product.findMany({
      where: { id: { in: productIds } },
      select: { id: true, name: true, price: true, image: true, size: true, sizePrices: true, category: true, stockQuantity: true },
    });
    const productsById = new Map(products.map((product) => [product.id, product]));
    if (productIds.some((id) => !productsById.has(id))) {
      return NextResponse.json({ error: "One or more cart products are no longer available. Refresh your cart and try again." }, { status: 409 });
    }

    const resolvedItems = items.map(({ productId, size, quantity }) => {
      const product = productsById.get(productId);
      const selectedSize = size || product.size;
      const price = getPriceForProductSize(product, selectedSize);
      return { product, size: selectedSize, price, quantity };
    });
    if (resolvedItems.some((item) => item.price === null)
      || new Set(resolvedItems.map((item) => JSON.stringify([item.product.id, item.size]))).size !== resolvedItems.length) {
      return NextResponse.json({ error: "One or more selected sizes are no longer available. Refresh your cart and try again." }, { status: 409 });
    }

    const orderItems = resolvedItems.map(({ product, size, price, quantity }) => {
      return {
        product_id: product.id,
        name: product.name,
        category: product.category,
        size,
        image: product.image,
        price,
        quantity,
        line_total: Number((price * quantity).toFixed(2)),
      };
    });
    const subtotal = Number(orderItems.reduce((sum, item) => sum + item.line_total, 0).toFixed(2));
    const shipping = DELIVERY_FEE;
    const total = Number((subtotal + shipping).toFixed(2));
    const amount = Math.round(total * 100);
    if (!Number.isSafeInteger(amount) || amount < 1) {
      return NextResponse.json({ error: "The checkout total is invalid for payment." }, { status: 400 });
    }

    let callbackUrl;
    try {
      callbackUrl = getPaystackCallbackUrl(request.url);
    } catch {
      return NextResponse.json({ error: "Configure PAYSTACK_CALLBACK_URL as the HTTPS /api/paystack/callback URL." }, { status: 503 });
    }

    const attempt = await prisma.$transaction(async (database) => {
      await reserveProductStock(database, items);
      return database.paymentAttempt.create({
        data: {
          reference: `sbc_${randomUUID().replaceAll("-", "")}`,
          amount,
          userId: user.id,
          reservationExpiresAt: new Date(Date.now() + 30 * 60 * 1000),
          checkoutData: {
            items: orderItems,
            subtotal,
            shipping,
            total,
            customerName: customerName.trim(),
            customerEmail: customerEmail.trim().toLowerCase(),
            phone: phone.trim(),
            shippingAddress: `${shippingAddress.trim()}\nCity / town: ${city.trim()}`,
          },
        },
      });
    });
    try {
      const transaction = await initializePaystackTransaction({
        email: customerEmail.trim().toLowerCase(),
        amount,
        reference: attempt.reference,
        callbackUrl,
        metadata: { payment_attempt_id: attempt.id },
      });
      if (transaction.reference !== attempt.reference) {
        throw new Error("Paystack returned a mismatched transaction reference.");
      }
      await prisma.paymentAttempt.update({ where: { id: attempt.id }, data: { status: "pending" } });
      return NextResponse.json({ accessCode: transaction.accessCode, reference: transaction.reference });
    } catch (error) {
      await prisma.$transaction(async (database) => {
        const currentAttempt = await database.paymentAttempt.findUnique({ where: { id: attempt.id } });
        if (currentAttempt) {
          await failPaymentAttemptAndReleaseStock(database, currentAttempt, "initializing");
        }
      });
      console.error("Could not initialize Paystack checkout:", error);
      return NextResponse.json({ error: "Could not start Paystack checkout. Please try again." }, { status: 502 });
    }
  } catch (error) {
    if (error instanceof InsufficientStockError) {
      return NextResponse.json({ error: error.message }, { status: 409 });
    }
    console.error("Could not prepare Paystack payment:", error);
    return NextResponse.json({ error: "Could not prepare checkout for payment." }, { status: 500 });
  }
}
