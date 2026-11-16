export class InsufficientStockError extends Error {
  constructor(productName, availableQuantity) {
    super(`${productName} has only ${availableQuantity} item${availableQuantity === 1 ? "" : "s"} available.`);
    this.name = "InsufficientStockError";
    this.productName = productName;
    this.availableQuantity = availableQuantity;
  }
}

export async function reserveProductStock(database, items) {
  for (const item of items) {
    const reservation = await database.product.updateMany({
      where: { id: item.productId, stockQuantity: { gte: item.quantity } },
      data: { stockQuantity: { decrement: item.quantity }, updatedAt: new Date() },
    });
    if (reservation.count === 0) {
      const product = await database.product.findUnique({
        where: { id: item.productId },
        select: { name: true, stockQuantity: true },
      });
      throw new InsufficientStockError(product?.name || "This product", product?.stockQuantity || 0);
    }
  }
}

export async function restoreReservedProductStock(database, items) {
  if (!Array.isArray(items)) throw new Error("Reserved checkout items are missing.");
  for (const item of items) {
    if (typeof item?.product_id !== "string" || !Number.isInteger(item.quantity) || item.quantity < 1) {
      throw new Error("Reserved checkout items are invalid.");
    }
    await database.product.updateMany({
      where: { id: item.product_id },
      data: { stockQuantity: { increment: item.quantity }, updatedAt: new Date() },
    });
  }
}

export async function failPaymentAttemptAndReleaseStock(database, attempt, expectedStatus) {
  const updated = await database.paymentAttempt.updateMany({
    where: { id: attempt.id, status: expectedStatus },
    data: { status: "failed", checkoutData: null, reservationExpiresAt: null },
  });
  if (updated.count === 0) return false;
  await restoreReservedProductStock(database, attempt.checkoutData?.items);
  return true;
}
