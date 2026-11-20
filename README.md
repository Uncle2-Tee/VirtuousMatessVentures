# Virtuous Matess Ventures

A polished, responsive Next.js ecommerce storefront with customer shopping and a private product-management workspace.

## Run locally

```bash
npm run dev
```

Visit `http://localhost:3000` for the customer storefront.

Without `DATABASE_URL`, local development shows the sample product catalogue. Database-backed features, including customer accounts, orders, and product management, require PostgreSQL to be configured as described below.

## Private admin workspace

The admin workspace is intentionally unlinked from the storefront and excluded from search indexing. Its route is `/admin`. From the dashboard, admins can update the three home-page hero images by uploading replacements and saving the changes.

Before using it, copy `.env.example` to `.env.local` and set the admin and PostgreSQL values:

```bash
ADMIN_USERNAME=your-admin-username
ADMIN_PASSWORD=use-a-long-unique-password
ADMIN_SESSION_SECRET=use-a-random-secret-with-at-least-32-characters
DATABASE_URL=postgresql://postgres.project-ref:URL-ENCODED-PASSWORD@pooler-host:6543/postgres?pgbouncer=true
DIRECT_URL=postgresql://postgres.project-ref:URL-ENCODED-PASSWORD@pooler-host:5432/postgres
```

You can generate a suitable session secret with:

```bash
node -e "console.log(require('crypto').randomBytes(32).toString('base64url'))"
```

Set `DATABASE_URL` and `DIRECT_URL` to PostgreSQL connection strings. For Supabase-hosted PostgreSQL, use the pooler connection on port `6543` with `pgbouncer=true` for `DATABASE_URL`, and port `5432` for `DIRECT_URL`. The application defaults Prisma's connection pool to five connections to handle concurrent requests; you can set `connection_limit` in `DATABASE_URL` to override this. URL-encode reserved characters in the password (for example, `@` becomes `%40`). Apply the Prisma schema, row-level security settings, and generate its client with:

```bash
npx prisma db push
npx prisma db execute --schema prisma/schema.prisma --file prisma/enable-rls.sql
npx prisma generate
npm run db:seed
```

The seed command removes the six retired skincare demo products by their original IDs, adds the current starter catalogue, and leaves other products unchanged. You can remove the sample products from the admin workspace as you replace them with your own catalogue. The application connects to PostgreSQL only from server routes through Prisma. Do not expose database credentials to browser code. Restart the development server after editing `.env.local`.

After applying the schema, admins can change their password from the dashboard. The new password is scrypt-hashed in the `admin_credentials` table; `ADMIN_PASSWORD` remains the bootstrap password until the first change. Changing it signs out other admin sessions while keeping the current session active. For password recovery, delete the `admin` row from `public.admin_credentials` in a trusted database console; the configured `ADMIN_PASSWORD` can then be used to sign in again.

When publishing a product, add a size and its price for each available option. Customers and sales staff select a size to see its exact price, and checkout revalidates that selection against the catalogue. The stock quantity entered for a product applies across all of its sizes.

On Vercel or another serverless host, add these variables in the project’s production environment settings. Vercel is configured to run `npm run build`, which synchronizes the Prisma schema and RLS settings before generating Prisma Client when `DATABASE_URL` is configured. Make sure both database URLs point to the intended production database. The admin username and password never reach the browser as configuration values. A successful sign-in creates an HMAC-signed, HTTP-only, SameSite-Strict session cookie containing the signed-in username; it expires after eight hours, and production cookies are HTTPS-only.

## Sales desk

The private salesperson workspace is available at `/sales`. Until an admin configures the sales login on `/admin`, `SALES_USERNAME` and `SALES_PASSWORD` in `.env.local` (or the hosting provider's environment) provide the bootstrap login. From the admin dashboard's **Manage passwords** section, select the admin or salesperson account to update its credentials. The salesperson password is scrypt-hashed, and changing credentials invalidates existing sales sessions. Sales sessions use the existing `ADMIN_SESSION_SECRET`; no admin credentials are shared with the sales account.

Sales staff can search the live catalogue, record counter sales paid by cash, Mobile Money, or card, and see recent transactions and daily totals. The dashboard shows total units across the catalogue and pulses the total and product badges when any item has five or fewer units. All paid online customer orders, including contact and delivery details, also appear on the sales dashboard and refresh every 10 seconds. Each counter sale records the signed-in salesperson, snapshots item names and prices, and deducts inventory atomically; insufficient stock prevents the sale. Admins can review recent in-store sales and daily totals on `/admin`. The `sales_transactions` and `sales_credentials` tables are included in the Prisma schema and row-level-security setup. Vercel builds synchronize the schema and apply RLS settings when production database URLs are configured. For other environments, apply the schema and RLS update before using the sales desk:

```bash
npx prisma db push
npx prisma db execute --schema prisma/schema.prisma --file prisma/enable-rls.sql
npx prisma generate
```

Counter receipts print as one compact 80 mm receipt with content-driven height. Select continuous receipt-roll paper in the printer settings for a clean cut at the end of the printed content.

The sales dashboard and sign-in route are excluded from search indexing. Sales access is protected by a separate HTTP-only, SameSite-Strict, eight-hour session cookie. The configured sales password is server-only and is never sent to the browser.

## Database-backed store

Products, product images, customer profiles, sessions, carts, wishlists, orders, payment attempts, and authentication throttles are stored in PostgreSQL. Customer sign-up and login use database-backed accounts with scrypt-hashed passwords and HTTP-only session cookies. Login applies a 15-minute account lockout after five failed attempts and a 15-minute, 20-attempt IP limit. Phone sign-in requires both the account password and a fresh SMS verification code before a session is created; email sign-in continues to use the password. Email-based password recovery is not available until an email delivery provider is configured. Delivery is free; no shipping fee is added to product or checkout totals. Checkout calculates totals on the server and opens Paystack's secure inline popup without navigating away from the storefront. It stores a payment attempt, but creates an order-history record only after server-side payment verification succeeds, so canceled or failed checkouts do not appear in My Orders. Paystack callbacks and signed webhooks are supported; card details are handled by Paystack and are never collected by this app.

The API validates the HTTP-only customer session cookie and only returns orders belonging to that customer. The admin dashboard has a separate admin-session-protected orders view, polls for new orders every 30 seconds while open, and can show browser notifications after the admin enables them. Browser notifications require the dashboard to remain open and permission to be granted. Database tables have row-level security enabled; all database access stays in server routes. Do not add public RLS policies for these tables.

Configure `PAYSTACK_SECRET_KEY` as a server-only environment variable in local development and production. Set `PAYSTACK_CALLBACK_URL` to `https://<your-domain>/api/paystack/callback` in production; local development can use its current origin. Configure the Paystack webhook URL as `https://<your-domain>/api/paystack/webhook` in the Paystack dashboard. Apply the updated Prisma schema before deploying the payment routes; `npm run build` runs `prisma db push` when `DATABASE_URL` is configured. Run the updated `prisma/enable-rls.sql` against the database to enable row-level security on the new payment-attempt table. Never expose or commit `PAYSTACK_SECRET_KEY`. The hosted redirect flow does not require the Paystack public key in browser code.

Customer sign-up verifies the chosen email or phone number before allowing account creation. Configure `RESEND_API_KEY` and `RESEND_FROM_EMAIL` for email verification, and `ARKESEL_API_KEY` plus a registered `ARKESEL_SENDER_ID` for SMS verification. These values must be server-side environment variables; do not expose or commit provider keys. After verifying contact and creating a password, customers are sent to password-only login.

Arkesel also sends the administrator an SMS after Paystack confirms payment and the order is created. Set `ADMIN_ORDER_SMS_PHONE` to the admin's international phone number (for example, `233XXXXXXXXX`). The notification runs after the payment response, so SMS delivery issues do not undo a verified payment. Failed sends are logged on the server.

Add these values to `.env.local` for local development and to the deployment environment for production:

```dotenv
RESEND_API_KEY=your-resend-api-key
RESEND_FROM_EMAIL=Virtuous Matess Ventures <verified-sender@example.com>
ARKESEL_API_KEY=your-arkesel-main-api-key
ARKESEL_SENDER_ID=your-registered-sender-id
ADMIN_ORDER_SMS_PHONE=233XXXXXXXXX
```

## Checks

```bash
npm run lint
npm run build
```

`npm run build` automatically runs `prisma db push` and regenerates Prisma Client when
`DATABASE_URL` is configured. The command does not accept destructive changes
automatically; it fails and requires explicit review if Prisma detects potential data loss.
