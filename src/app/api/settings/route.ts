import { handleGetSettings, handlePutSettings } from "@/lib/auth/handlers"

export const runtime = "nodejs"
export const dynamic = "force-dynamic"

export async function GET(request: Request) {
  return handleGetSettings(request)
}

export async function PUT(request: Request) {
  return handlePutSettings(request)
}
