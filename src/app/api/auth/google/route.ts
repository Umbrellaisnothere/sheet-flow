import { handleGoogleStart } from "@/lib/auth/handlers"

export const runtime = "nodejs"
export const dynamic = "force-dynamic"

export async function GET(request: Request) {
  return handleGoogleStart(request)
}
