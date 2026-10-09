const HEX6 = /^#[0-9a-f]{6}$/
const HEX3 = /^#[0-9a-f]{3}$/
const OPACITY_MIN = 0.05
const OPACITY_MAX = 0.5

export const DEFAULT_COLOR = "#1a73e8"
export const DEFAULT_OPACITY = "0.1"

export function parseApiColor(value: unknown): string | null {
  if (typeof value !== "string" && typeof value !== "number") {
    return null
  }
  let text = String(value).trim().toLowerCase().replace(/\s/g, "")
  if (!text) {
    return null
  }
  if (
    text.includes(";") ||
    text.includes("(") ||
    text.includes(")") ||
    text.includes(":") ||
    text.includes("/")
  ) {
    return null
  }
  if (text.charAt(0) !== "#") {
    text = "#" + text
  }
  if (HEX6.test(text)) {
    return text
  }
  if (HEX3.test(text)) {
    return (
      "#" +
      text.charAt(1) +
      text.charAt(1) +
      text.charAt(2) +
      text.charAt(2) +
      text.charAt(3) +
      text.charAt(3)
    )
  }
  return null
}

export function parseApiOpacity(value: unknown): string | null {
  if (typeof value !== "string" && typeof value !== "number") {
    return null
  }
  if (typeof value === "string" && value.trim() === "") {
    return null
  }
  const number = Number(value)
  if (!Number.isFinite(number)) {
    return null
  }
  if (number < OPACITY_MIN || number > OPACITY_MAX) {
    return null
  }
  return String(Math.round(number * 100) / 100)
}

export function isoNow(date = new Date()): string {
  return date.toISOString()
}
