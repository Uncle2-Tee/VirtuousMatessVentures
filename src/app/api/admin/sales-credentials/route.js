import { cookies } from "next/headers";
import { NextResponse } from "next/server";
import { ADMIN_SESSION_COOKIE, hasValidAdminSession } from "../../../../lib/admin-auth";
import { getSalesLoginSettings, updateSalesCredentials } from "../../../../lib/sales-auth";

export const runtime = "nodejs";

async function requireAdmin() {
  const cookieStore = await cookies();
  return hasValidAdminSession(cookieStore.get(ADMIN_SESSION_COOKIE)?.value);
}

export async function GET() {
  if (!(await requireAdmin())) return NextResponse.json({ error: "Admin sign-in required." }, { status: 401 });
  try {
    return NextResponse.json(await getSalesLoginSettings());
  } catch (error) {
    console.error("Could not load sales login settings:", error);
    return NextResponse.json({ error: "Could not load sales login settings." }, { status: 503 });
  }
}

export async function POST(request) {
  if (!(await requireAdmin())) return NextResponse.json({ error: "Admin sign-in required." }, { status: 401 });

  let username;
  let password;
  try {
    ({ username, password } = await request.json());
  } catch {
    return NextResponse.json({ error: "Invalid sales login settings." }, { status: 400 });
  }

  if (typeof username !== "string" || !/^[A-Za-z0-9._-]{3,32}$/.test(username.trim())
    || typeof password !== "string" || password.length < 8 || password.length > 128) {
    return NextResponse.json({
      error: "Use a 3–32 character username (letters, numbers, dots, underscores, or hyphens) and a password between 8 and 128 characters.",
    }, { status: 400 });
  }

  try {
    const credential = await updateSalesCredentials(username.trim(), password);
    return NextResponse.json({ ok: true, username: credential.username });
  } catch (error) {
    if (error.code === "P2002") {
      return NextResponse.json({ error: "That sales username is already in use." }, { status: 409 });
    }
    console.error("Could not update sales login settings:", error);
    return NextResponse.json({ error: "Could not update sales login settings." }, { status: 503 });
  }
}
