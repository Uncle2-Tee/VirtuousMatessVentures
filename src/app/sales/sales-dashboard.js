"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import BrandWordmark from "../components/brand-wordmark";
import { getPriceForProductSize, getProductSizePrices } from "../../lib/products";

const money = new Intl.NumberFormat("en-GH", { style: "currency", currency: "GHS", minimumFractionDigits: 2 });
const quantityFormatter = new Intl.NumberFormat("en-GH");
const paymentLabels = { cash: "Cash", mobile_money: "Mobile Money", card: "Card" };
const orderPaymentLabels = { paystack: "Paystack", momo: "Mobile Money", cash: "Cash", card: "Card" };
const orderStatusLabels = {
  payment_review: "Awaiting processing",
  processing: "Processing",
  shipped: "Shipped",
  delivered: "Delivered",
  cancelled: "Cancelled",
};
const DASHBOARD_REFRESH_INTERVAL_MS = 10_000;

function salesLineKey(item) {
  return JSON.stringify([item.id, item.size || ""]);
}

async function readApiResponse(response) {
  const body = await response.json().catch(() => ({}));
  if (!response.ok) throw new Error(body.error || "The request could not be completed.");
  return body;
}

function formatSaleTime(value) {
  return new Intl.DateTimeFormat("en-GH", { hour: "numeric", minute: "2-digit" }).format(new Date(value));
}

function formatOrderTime(value) {
  return new Intl.DateTimeFormat("en-GH", { dateStyle: "medium", timeStyle: "short" }).format(new Date(value));
}

function OnlineOrderCard({ order }) {
  const statusLabel = orderStatusLabels[order.status] || order.status.replaceAll("_", " ");

  return <article className="sales-order-card">
    <header className="sales-order-card-heading">
      <div><span className="sales-order-number">Order #{order.id.slice(0, 8).toUpperCase()}</span><time dateTime={order.created_at}>{formatOrderTime(order.created_at)}</time></div>
      <span className={`sales-order-status sales-order-status-${orderStatusLabels[order.status] ? order.status : "other"}`}>{statusLabel}</span>
    </header>
    <div className="sales-order-customer"><strong>{order.customer_name}</strong><span>{order.phone}</span></div>
    <ul className="sales-order-items">{order.items.map((item, index) => (
      <li key={`${item.product_id || item.name}-${index}`}><span>{item.name} <small>× {quantityFormatter.format(item.quantity)}</small></span><strong>{money.format(Number(item.line_total ?? Number(item.price) * item.quantity))}</strong></li>
    ))}</ul>
    <div className="sales-order-card-footer">
      <span>{orderPaymentLabels[order.payment_method] || order.payment_method.replaceAll("_", " ")}</span>
      <div><small>Order total</small><strong>{money.format(order.total)}</strong></div>
    </div>
    <details className="sales-order-delivery">
      <summary>Delivery details</summary>
      <address>{order.shipping_address}</address>
    </details>
  </article>;
}

function SaleReceiptCopy({ sale, headingId }) {
  const receiptNumber = sale.id.slice(0, 8).toUpperCase();
  const issuedAt = new Intl.DateTimeFormat("en-GH", { dateStyle: "medium", timeStyle: "short" }).format(new Date(sale.created_at));

  return <div className="sales-receipt-content">
    <header className="sales-receipt-header">
      <div className="sales-receipt-branding">
        <BrandWordmark className="sales-receipt-logo" />
        <div><p className="sales-eyebrow">Virtuous Matess Ventures</p><h2 id={headingId}>Sales receipt</h2></div>
      </div>
      <div className="sales-receipt-number"><span>Receipt</span><strong>#{receiptNumber}</strong></div>
    </header>
    <div className="sales-receipt-meta">
      <div><span>Date &amp; time</span><time dateTime={sale.created_at}>{issuedAt}</time></div>
      <div><span>Issued by</span><strong>{sale.salesperson}</strong></div>
      <div><span>Payment method</span><strong>{paymentLabels[sale.payment_method] || sale.payment_method}</strong></div>
    </div>
    <div className="sales-receipt-table-wrap">
      <table className="sales-receipt-table">
        <thead><tr><th>Item</th><th className="sales-receipt-quantity">Qty</th><th className="sales-receipt-amount">Unit price</th><th className="sales-receipt-amount">Amount</th></tr></thead>
        <tbody>{sale.items.map((item, index) => (
          <tr key={`${item.product_id || item.name}-${index}`}>
            <td>{item.name}{item.size ? <small>{item.size}</small> : null}</td>
            <td className="sales-receipt-quantity">{quantityFormatter.format(item.quantity)}</td>
            <td className="sales-receipt-amount">{money.format(Number(item.price))}</td>
            <td className="sales-receipt-amount">{money.format(Number(item.line_total))}</td>
          </tr>
        ))}</tbody>
      </table>
    </div>
    <div className="sales-receipt-total"><span>Total paid</span><strong>{money.format(sale.subtotal)}</strong></div>
    <p className="sales-receipt-thanks">Thank you for shopping with us.</p>
  </div>;
}

function SaleReceipt({ sale, onClose, onPrint }) {
  return <section className="sales-receipt-panel" aria-labelledby="sales-receipt-heading">
    <SaleReceiptCopy sale={sale} headingId="sales-receipt-heading" />
    <div className="sales-receipt-print-sheet" aria-hidden="true">
      <article className="sales-receipt-print-copy"><SaleReceiptCopy sale={sale} /></article>
    </div>
    <div className="sales-receipt-actions">
      <button type="button" className="sales-receipt-print" onClick={onPrint}>Print receipt</button>
      <button type="button" className="sales-receipt-close" onClick={onClose}>Close</button>
    </div>
  </section>;
}

export default function SalesDashboard({ username, showAdminReturn = false, readOnly = false }) {
  const router = useRouter();
  const [dashboard, setDashboard] = useState(null);
  const [loading, setLoading] = useState(true);
  const [loadError, setLoadError] = useState("");
  const [search, setSearch] = useState("");
  const [category, setCategory] = useState("All");
  const [cart, setCart] = useState([]);
  const [selectedSizes, setSelectedSizes] = useState({});
  const [paymentMethod, setPaymentMethod] = useState("cash");
  const [savingSale, setSavingSale] = useState(false);
  const [saleError, setSaleError] = useState("");
  const [saleNotice, setSaleNotice] = useState("");
  const [completedSale, setCompletedSale] = useState(null);

  const refreshDashboard = useCallback(async () => {
    try {
      const data = await readApiResponse(await fetch(readOnly ? "/api/admin/sales" : "/api/sales", { cache: "no-store" }));
      setDashboard(data);
      setCart((current) => {
        const remainingStock = new Map(data.products.map((product) => [product.id, product.stockQuantity]));
        return current.flatMap((item) => {
          const latestProduct = data.products.find((product) => product.id === item.id);
          if (!latestProduct) return [];
          const size = item.size || latestProduct.size;
          const price = getPriceForProductSize(latestProduct, size);
          const available = remainingStock.get(item.id);
          const quantity = Math.min(item.quantity, Math.max(available, 0));
          if (price === null || quantity < 1) return [];
          remainingStock.set(item.id, available - quantity);
          return [{ ...latestProduct, size, price, quantity }];
        });
      });
      setLoadError("");
    } catch (error) {
      setLoadError(error.message || "Could not load the sales desk.");
    } finally {
      setLoading(false);
    }
  }, [readOnly]);

  useEffect(() => {
    let active = true;
    const refresh = async () => {
      if (active && document.visibilityState === "visible") await refreshDashboard();
    };
    void refresh();
    const interval = window.setInterval(refresh, DASHBOARD_REFRESH_INTERVAL_MS);
    window.addEventListener("focus", refresh);
    document.addEventListener("visibilitychange", refresh);
    return () => {
      active = false;
      window.clearInterval(interval);
      window.removeEventListener("focus", refresh);
      document.removeEventListener("visibilitychange", refresh);
    };
  }, [refreshDashboard]);

  const categories = useMemo(() => ["All", ...new Set((dashboard?.products || []).map((product) => product.category))], [dashboard]);
  const visibleProducts = useMemo(() => {
    const query = search.trim().toLowerCase();
    return (dashboard?.products || []).filter((product) =>
      (category === "All" || product.category === category)
      && (!query || `${product.name} ${product.category} ${product.size}`.toLowerCase().includes(query)));
  }, [category, dashboard, search]);
  const cartTotal = cart.reduce((total, item) => total + Math.round(item.price * 100) * item.quantity, 0) / 100;
  const cartUnits = cart.reduce((total, item) => total + item.quantity, 0);

  function addToCart(product, size) {
    setSaleError("");
    setSaleNotice("");
    const price = getPriceForProductSize(product, size);
    if (price === null) {
      setSaleError("That size is no longer available. Refresh inventory and try again.");
      return;
    }
    const productQuantity = cart.filter((item) => item.id === product.id).reduce((total, item) => total + item.quantity, 0);
    if (productQuantity >= product.stockQuantity) {
      setSaleError(`Only ${product.stockQuantity} ${product.stockQuantity === 1 ? "unit is" : "units are"} available for ${product.name}.`);
      return;
    }
    setCart((current) => {
      if (current.some((item) => item.id === product.id && item.size === size)) return current.map((item) => item.id === product.id && item.size === size ? { ...item, quantity: item.quantity + 1 } : item);
      return [...current, { ...product, size, price, quantity: 1 }];
    });
  }

  function changeQuantity(productId, size, delta) {
    setCart((current) => current.flatMap((item) => {
      if (item.id !== productId || item.size !== size) return [item];
      const quantity = item.quantity + delta;
      if (quantity < 1) return [];
      const available = dashboard?.products.find((product) => product.id === productId)?.stockQuantity ?? item.stockQuantity;
      if (available < 1) return [];
      const quantityInCart = current.filter((line) => line.id === productId).reduce((total, line) => total + line.quantity, 0);
      if (delta > 0 && quantityInCart >= available) return [item];
      return [{ ...item, quantity: Math.max(1, Math.min(quantity, available)) }];
    }));
  }

  async function completeSale(event) {
    event.preventDefault();
    if (!cart.length || savingSale) return;
    setSaleError("");
    setSaleNotice("");
    setSavingSale(true);
    try {
      const { sale } = await readApiResponse(await fetch("/api/sales", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          paymentMethod,
          items: cart.map((item) => ({ productId: item.id, size: item.size, quantity: item.quantity })),
        }),
      }));
      setCart([]);
      setSaleNotice(`Sale ${sale.id.slice(0, 8).toUpperCase()} recorded. Receipt is ready to print.`);
      setCompletedSale(sale);
      await refreshDashboard();
    } catch (error) {
      setSaleError(error.message || "Could not record this sale.");
      await refreshDashboard();
    } finally {
      setSavingSale(false);
    }
  }

  async function signOut() {
    try {
      await readApiResponse(await fetch("/api/sales/session", { method: "DELETE" }));
      router.refresh();
    } catch (error) {
      setLoadError(error.message || "Could not sign out. Please try again.");
    }
  }

  return <main className="sales-shell">
    <header className="sales-header">
      <Link href="/" aria-label="Virtuous Matess Ventures home"><BrandWordmark /></Link>
      <div className="sales-header-right">{showAdminReturn && <Link className="sales-admin-return" href="/admin"><span aria-hidden="true">←</span> Admin dashboard</Link>}<span className="sales-online-indicator"><i />{readOnly ? "Admin monitor" : "Sales desk"}</span><span className="sales-user">{readOnly ? "Read-only" : username}</span>{!readOnly && <button type="button" className="sales-sign-out" onClick={signOut}><svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true"><path d="M10 17l5-5-5-5" /><path d="M15 12H3" /><path d="M12 3h6a2 2 0 0 1 2 2v14a2 2 0 0 1-2 2h-6" /></svg><span>Sign out</span></button>}</div>
    </header>

    <section className="sales-metrics" aria-label="Today's sales summary">
      <article><span>Today’s revenue</span><strong>{dashboard ? money.format(dashboard.today.revenue) : "—"}</strong><small>In-store sales recorded today</small></article>
      <article><span>Transactions</span><strong>{dashboard ? quantityFormatter.format(dashboard.today.count) : "—"}</strong><small>Sales completed today</small></article>
      <article><span>Products in stock</span><strong>{dashboard ? quantityFormatter.format(dashboard.products.filter((product) => product.stockQuantity > 0).length) : "—"}</strong><small>Available to sell</small></article>
      <article className={dashboard?.lowStockCount ? "sales-metric-warning" : ""}><span>Total stock units</span><strong>{dashboard ? quantityFormatter.format(dashboard.totalStockQuantity) : "—"}</strong><small>{dashboard?.lowStockCount ? `${quantityFormatter.format(dashboard.lowStockCount)} products at five units or fewer` : "Across all products · no low-stock alerts"}</small></article>
    </section>

    {loadError && <p className="sales-banner sales-banner-error" role="alert">{loadError}<button type="button" onClick={() => { setLoading(true); void refreshDashboard(); }}>Retry</button></p>}
    {saleNotice && <p className="sales-banner sales-banner-success" role="status">{saleNotice}</p>}
    {completedSale && <SaleReceipt sale={completedSale} onPrint={() => window.print()} onClose={() => setCompletedSale(null)} />}

    <section className="sales-orders-panel" aria-labelledby="sales-orders-heading">
      <div className="sales-section-heading"><div><p className="sales-eyebrow">Online checkout</p><h2 id="sales-orders-heading">Customer orders</h2></div><span className="sales-history-refresh">Live updates every 10 seconds</span></div>
      {dashboard?.onlineOrders.length ? <div className="sales-orders-grid">{dashboard.onlineOrders.map((order) => <OnlineOrderCard key={order.id} order={order} />)}</div>
        : <div className="sales-orders-empty">{loading ? "Loading customer orders…" : "No customer orders yet. Newly paid online orders will appear here."}</div>}
    </section>

    <section className={`sales-workspace${readOnly ? " sales-workspace-readonly" : ""}`} aria-label="Point of sale">
      <div className="sales-products-panel">
        <div className="sales-section-heading"><div><p className="sales-eyebrow">Point of sale</p><h2>Choose products</h2></div><span className="sales-product-count">{dashboard ? `${dashboard.products.length} products` : "Loading…"}</span></div>
        <div className="sales-filters">
          <label className="sales-search"><span aria-hidden="true">⌕</span><input aria-label="Search products" value={search} onChange={(event) => setSearch(event.target.value)} placeholder="Search the collection" /></label>
          <label className="sales-category-filter"><span className="visually-hidden">Filter by category</span><select value={category} onChange={(event) => setCategory(event.target.value)}>{categories.map((item) => <option key={item}>{item}</option>)}</select></label>
        </div>
        {loading && !dashboard ? <div className="sales-empty-state">Loading live inventory…</div>
          : dashboard?.products.length === 0 ? <div className="sales-empty-state"><strong>No products in the catalogue</strong><span>Products added by the admin will appear here.</span></div>
            : visibleProducts.length === 0 ? <div className="sales-empty-state"><strong>No matching products</strong><span>Try a different search or category.</span></div>
              : <div className="sales-product-grid">{visibleProducts.map((product) => {
                const inCart = cart.filter((item) => item.id === product.id).reduce((total, item) => total + item.quantity, 0);
                const sizeOptions = getProductSizePrices(product);
                const selectedSize = selectedSizes[product.id] || sizeOptions[0]?.size || product.size;
                const selectedPrice = getPriceForProductSize(product, selectedSize);
                const displayedPrice = readOnly && sizeOptions.length > 1
                  ? `From ${money.format(Math.min(...sizeOptions.map((option) => Number(option.price))))}`
                  : money.format(selectedPrice ?? product.price);
                return <article className={`sales-product-card${product.stockQuantity === 0 ? " is-sold-out" : ""}`} key={product.id}>
                  <div className="sales-product-image" style={{ backgroundImage: product.image ? `url("${product.image}")` : undefined }}><span className={product.stockQuantity <= 5 ? "sales-stock-pill sales-stock-pill-low" : "sales-stock-pill"}>{product.stockQuantity === 0 ? "Sold out" : `${product.stockQuantity} in stock`}</span></div>
                  <div className="sales-product-info"><span>{product.category}</span><h3>{product.name}</h3>{!readOnly && <label className="sales-size-choice">Size<select value={selectedSize} onChange={(event) => setSelectedSizes((current) => ({ ...current, [product.id]: event.target.value }))}>{sizeOptions.map((option) => <option key={option.size} value={option.size}>{option.size}</option>)}</select></label>}<div><strong>{displayedPrice}</strong>{!readOnly && <button type="button" onClick={() => addToCart(product, selectedSize)} disabled={product.stockQuantity === 0 || inCart >= product.stockQuantity} aria-label={`Add ${product.name}, size ${selectedSize}, to sale`}>{inCart ? `Added · ${inCart}` : "Add to sale"}<span aria-hidden="true">+</span></button>}</div></div>
                </article>;
              })}</div>}
      </div>

      {!readOnly && <aside className="sales-checkout-panel" aria-labelledby="sales-checkout-heading">
        <div className="sales-section-heading"><div><p className="sales-eyebrow">Current transaction</p><h2 id="sales-checkout-heading">Sale summary</h2></div><span className="sales-cart-count">{cartUnits} {cartUnits === 1 ? "item" : "items"}</span></div>
        {cart.length === 0 ? <div className="sales-cart-empty"><span aria-hidden="true">＋</span><strong>Your sale is empty</strong><small>Add products from the collection to begin.</small></div>
          : <ul className="sales-cart-list">{cart.map((item) => <li key={salesLineKey(item)}><div className="sales-cart-item-name"><strong>{item.name}</strong><small>{item.size} · {money.format(item.price)} each</small></div><div className="sales-quantity-control"><button type="button" onClick={() => changeQuantity(item.id, item.size, -1)} aria-label={`Remove one ${item.name}, size ${item.size}`}>−</button><span>{item.quantity}</span><button type="button" onClick={() => changeQuantity(item.id, item.size, 1)} disabled={cart.filter((line) => line.id === item.id).reduce((total, line) => total + line.quantity, 0) >= (dashboard?.products.find((product) => product.id === item.id)?.stockQuantity ?? item.stockQuantity)} aria-label={`Add one ${item.name}, size ${item.size}`}>+</button></div><strong className="sales-line-total">{money.format(item.price * item.quantity)}</strong></li>)}</ul>}
        <div className="sales-checkout-footer">
          <label htmlFor="sales-payment-method">Payment received by</label>
          <select id="sales-payment-method" value={paymentMethod} onChange={(event) => setPaymentMethod(event.target.value)}><option value="cash">Cash</option><option value="mobile_money">Mobile Money</option><option value="card">Card</option></select>
          <div className="sales-total-row"><span>Total</span><strong>{money.format(cartTotal)}</strong></div>
          {saleError && <p className="sales-checkout-error" role="alert">{saleError}</p>}
          <button type="button" className="sales-complete-button" disabled={!cart.length || savingSale || Boolean(loadError)} onClick={completeSale}>{savingSale ? "Recording sale…" : "Complete sale"}<span aria-hidden="true">→</span></button>
          <small className="sales-stock-note">Stock updates as soon as the sale is recorded.</small>
        </div>
      </aside>}
    </section>

    <section className="sales-history-panel" aria-labelledby="sales-history-heading">
      <div className="sales-section-heading"><div><p className="sales-eyebrow">A clear record</p><h2 id="sales-history-heading">Recent sales</h2></div><span className="sales-history-refresh">Live updates every 10 seconds</span></div>
      {dashboard?.recentSales.length ? <div className="sales-history-table-wrap"><table className="sales-history-table"><thead><tr><th>Receipt</th><th>Items</th><th>Payment</th><th>Recorded by</th><th>Time</th><th className="sales-table-amount">Total</th>{!readOnly && <th>Action</th>}</tr></thead><tbody>{dashboard.recentSales.map((sale) => <tr key={sale.id}><td><span className="sales-receipt-id">#{sale.id.slice(0, 8).toUpperCase()}</span></td><td>{sale.items.map((item) => `${item.name} × ${item.quantity}`).join(", ")}</td><td>{paymentLabels[sale.payment_method] || sale.payment_method}</td><td>{sale.salesperson}</td><td>{formatSaleTime(sale.created_at)}</td><td className="sales-table-amount">{money.format(sale.subtotal)}</td>{!readOnly && <td><button className="sales-history-receipt-button" type="button" onClick={() => { setCompletedSale(sale); window.scrollTo({ top: 0, behavior: "smooth" }); }}>Issue receipt</button></td>}</tr>)}</tbody></table></div>
        : <div className="sales-history-empty">{loading ? "Loading recent sales…" : "No in-store sales have been recorded yet."}</div>}
    </section>
  </main>;
}
