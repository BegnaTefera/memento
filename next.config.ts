import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  // firebase-admin's auth module pulls in jwks-rsa, which imports the ESM-only
  // "jose" package. Turbopack/webpack trying to bundle that chain breaks with
  // ERR_REQUIRE_ESM. Excluding these from bundling lets Node load them
  // natively at runtime instead, where CJS/ESM interop actually works.
  serverExternalPackages: ["firebase-admin", "jwks-rsa", "jose"],
};


export default nextConfig;