import Link from "next/link"
import { ArrowRightLeft, MousePointerClick, Zap } from "lucide-react"

const steps = [
  {
    href: "/instant",
    icon: Zap,
    title: "1. Instant highlight",
    body: "Install the Tampermonkey script. The colour chip appears on the sheet. No Apps Script delay.",
    cta: "Install the userscript",
  },
  {
    href: "/script",
    icon: ArrowRightLeft,
    title: "2. Move visible records",
    body: "Paste Code.gs once. The Focus Cell menu can move filtered rows without overwriting occupied cells.",
    cta: "Copy Code.gs",
  },
  {
    href: "#demo",
    icon: MousePointerClick,
    title: "3. Try it on this page",
    body: "This grid is a demo, not Google Sheets. Click around, then move the Ready rows from D into E.",
    cta: "Jump to the demo",
  },
]

export function StartHere() {
  return (
    <section aria-labelledby="start-here-heading" className="space-y-3">
      <div>
        <h2 id="start-here-heading" className="text-base font-semibold">
          Start here
        </h2>
        <p className="mt-1 text-sm text-muted-foreground">
          Two installs, one job each. The highlight lives in your browser. Move
          Visible Records lives in the spreadsheet menu.
        </p>
      </div>
      <ol className="grid gap-3 md:grid-cols-3">
        {steps.map((step) => {
          const Icon = step.icon
          return (
            <li
              key={step.href}
              className="flex flex-col rounded-lg border border-[#d0d0d0] bg-white p-4 shadow-sm"
            >
              <div className="flex items-center gap-2 text-[#217346]">
                <Icon className="size-4" />
                <h3 className="text-sm font-semibold">{step.title}</h3>
              </div>
              <p className="mt-2 flex-1 text-sm text-muted-foreground">
                {step.body}
              </p>
              <Link
                href={step.href}
                className="mt-3 text-sm font-medium text-[#217346] underline"
              >
                {step.cta}
              </Link>
            </li>
          )
        })}
      </ol>
    </section>
  )
}
