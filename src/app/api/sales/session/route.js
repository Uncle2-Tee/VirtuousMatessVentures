import { NextResponse } from "next/server";
import {
  createSalesSession,
  isSalesAuthConfigured,
  SALES_SESSION_COOKIE,
  salesCredentialsMatch,
  salesSessionOptions,
} from "../../../../lib/sales-auth";

export const runtime = "nodejs";

export async function POST(request) {
  let username = "";
  let password = "";
  try {
    ({ username = "", password = "" } = await request.json());
  } catch {
    return NextResponse.json({ error: "Invalid sign-in request." }, { status: 400 });
  }

  if (typeof username !== "string" || username.length > 32
    || typeof password !== "string" || password.length > 128) {
    return NextResponse.json({ error: "Enter a valid sales username and password." }, { status: 400 });
  }

  try {
    if (!(await isSalesAuthConfigured())) {
      return NextResponse.json({ error: "Sales access has not been configured." }, { status: 503 });
    }

    if (!(await salesCredentialsMatch(username, password))) {
      return NextResponse.json({ error: "That username or password is not recognized." }, { status: 401 });
    }

    const session = await createSalesSession();
    if (!session) return NextResponse.json({ error: "Sales access has not been configured." }, { status: 503 });

    const response = NextResponse.json({ ok: true });
    response.cookies.set(SALES_SESSION_COOKIE, session.value, salesSessionOptions);
    return response;
  } catch (error) {
    console.error("Could not verify salesperson credentials:", error);
    return NextResponse.json({ error: "Sales sign-in is temporarily unavailable." }, { status: 503 });
  }
}

export async function DELETE() {
  const response = NextResponse.json({ ok: true });
  response.cookies.set(SALES_SESSION_COOKIE, "", { ...salesSessionOptions, maxAge: 0 });
  return response;
}
