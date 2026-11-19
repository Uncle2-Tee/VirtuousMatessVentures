export function orderToSalesApi(order) {
  return {
    id: order.id,
    status: order.status,
    payment_method: order.paymentMethod,
    items: order.items,
    subtotal: Number(order.subtotal),
    shipping: Number(order.shipping),
    total: Number(order.total),
    customer_name: order.customerName,
    phone: order.phone,
    shipping_address: order.shippingAddress,
    created_at: order.createdAt.toISOString(),
  };
}
