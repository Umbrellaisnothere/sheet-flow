import { handleSyncPoll } from "@/lib/auth/handlers"

export const runtime = "nodejs"
export const dynamic = "force-dynamic"

export async function POST(request: Request) {
  return handleSyncPoll(request)
}
