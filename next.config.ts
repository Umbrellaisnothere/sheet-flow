import type { NextConfig } from "next";

import { resolveRuntimeAppOrigin } from "./src/lib/auth/origin";

resolveRuntimeAppOrigin(process.env);

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
