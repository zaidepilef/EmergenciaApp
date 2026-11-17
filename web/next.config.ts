import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  // Permite abrir el dashboard de desarrollo desde otro equipo de la red local.
  allowedDevOrigins: (process.env.DEV_ALLOWED_ORIGINS ?? "").split(",").filter(Boolean),
  poweredByHeader: false,
  turbopack: { root: import.meta.dirname },
};

export default nextConfig;
