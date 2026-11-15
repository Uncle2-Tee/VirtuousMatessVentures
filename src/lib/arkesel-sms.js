const ARKESEL_SMS_URL = "https://sms.arkesel.com/api/v2/sms/send";

function normalizeRecipient(phone) {
  const compact = phone.trim().replace(/[\s().-]/g, "");
  let number = compact.startsWith("+")
    ? compact.slice(1)
    : compact.startsWith("00")
      ? compact.slice(2)
      : compact;

  if (/^0\d{9}$/.test(number)) number = `233${number.slice(1)}`;
  if (!/^[1-9]\d{7,14}$/.test(number)) {
    throw new Error("ADMIN_ORDER_SMS_PHONE must be a valid international phone number.");
  }
  return number;
}

function buildOrderMessage(order) {
  const orderNumber = typeof order?.id === "string" ? order.id.slice(0, 8).toUpperCase() : "";
  const customerName = typeof order?.customerName === "string"
    ? order.customerName.replace(/\s+/g, " ").trim().slice(0, 40)
    : "";
  const total = Number(order?.total);
  if (!orderNumber || !Number.isFinite(total) || total < 0) {
    throw new Error("Order details are invalid for an admin SMS notification.");
  }

  return `New paid order #${orderNumber} from ${customerName || "Customer"}. Total GHS ${total.toFixed(2)}. Check the admin dashboard.`;
}

export async function sendArkeselAdminOrderSms(order) {
  const apiKey = process.env.ARKESEL_API_KEY?.trim();
  const sender = process.env.ARKESEL_SENDER_ID?.trim();
  const recipient = process.env.ADMIN_ORDER_SMS_PHONE;
  if (!apiKey || !sender || !recipient?.trim()) {
    throw new Error("Order SMS is not configured. Set ARKESEL_API_KEY, ARKESEL_SENDER_ID, and ADMIN_ORDER_SMS_PHONE.");
  }

  const response = await fetch(ARKESEL_SMS_URL, {
    method: "POST",
    headers: {
      "api-key": apiKey,
      "Content-Type": "application/json",
    },
    body: JSON.stringify({
      sender,
      message: buildOrderMessage(order),
      recipients: [normalizeRecipient(recipient)],
    }),
    signal: AbortSignal.timeout(10000),
  });
  const result = await response.json().catch(() => null);
  if (!response.ok || result?.status !== "success") {
    const providerStatus = typeof result?.status === "string" ? ` (${result.status})` : "";
    throw new Error(`Arkesel rejected the order SMS request with HTTP ${response.status}${providerStatus}.`);
  }
}
