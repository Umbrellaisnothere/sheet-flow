"use client"

import Link from "next/link"
import { usePathname } from "next/navigation"
import { Crosshair } from "lucide-react"

import { cn } from "@/lib/utils"

const links = [
  { href: "/", label: "Try the demo" },
  { href: "/instant", label: "Instant highlight" },
  { href: "/script", label: "Apps Script" },
]

export function SiteNav() {
  const pathname = usePathname()

  return (
    <>
      <Link href="/" className="flex items-center gap-2 text-[#217346]">
        <Crosshair className="size-4" />
        <span className="text-sm font-semibold tracking-tight">
          Focus Cell
        </span>
      </Link>
      <ul className="flex flex-wrap gap-1">
        {links.map((link) => {
          const current =
            link.href === "/"
              ? pathname === "/"
              : pathname.startsWith(link.href)
          return (
            <li key={link.href}>
              <Link
                href={link.href}
                aria-current={current ? "page" : undefined}
                className={cn(
                  "inline-flex h-8 items-center rounded-lg px-2.5 text-sm",
                  current
                    ? "bg-[#217346] text-white"
                    : "text-[#3c4043] hover:bg-[#e8f5ee]"
                )}
              >
                {link.label}
              </Link>
            </li>
          )
        })}
      </ul>
    </>
  )
}
