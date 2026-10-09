import type { NextConfig } from "next";

import { resolveAppOrigin } from "./src/lib/auth/origin";

resolveAppOrigin(
  process.env.APP_ORIGIN ?? "",
  process.env.NODE_ENV ?? "development"
);

const nextConfig: NextConfig = {
  allowedDevOrigins: [
    "127.0.0.1",
    "localhost",
    "*.cursor.sh",
    "*.cursor.com",
    "*.dev.cursor.com",
  ],
  serverExternalPackages: ["postgres"],
  devIndicators: false,
};

export default nextConfig;
