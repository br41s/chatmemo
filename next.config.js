const withBundleAnalyzer = require("@next/bundle-analyzer")({
  enabled: process.env.ANALYZE === "true"
})

const withPWA = require("@ducanh2912/next-pwa").default({
  dest: "public",
  // No runtime caching. The default rules kept every same-origin GET under
  // /api (memory exports, the timeline, the key flags) and the page payload
  // (which carries the profile, provider keys included) in Cache Storage for
  // a day, readable after sign-out on a shared device. Static assets are
  // still precached; the app is online-only anyway.
  workboxOptions: { runtimeCaching: [] }
})

// Image sources the browser may load, enforced by the browser itself: the
// markdown renderer refuses other sources too, but a policy header holds for
// every element on every page. Only the user's own storage project is allowed,
// so a self-hosted Supabase works without a wildcard; the wildcards stand in
// when the URL is not set at build time (tests).
const storageOrigin = (() => {
  try {
    return new URL(process.env.NEXT_PUBLIC_SUPABASE_URL).origin
  } catch {
    return "https://*.supabase.co https://*.supabase.in"
  }
})()
const devImageOrigins =
  process.env.NODE_ENV === "production"
    ? ""
    : " http://localhost:* http://127.0.0.1:*"
const contentSecurityPolicy = [
  `img-src 'self' data: blob: ${storageOrigin}${devImageOrigins}`,
  "object-src 'none'",
  "base-uri 'self'",
  "frame-ancestors 'self'"
].join("; ")

const securityHeaders = [
  { key: "Content-Security-Policy", value: contentSecurityPolicy },
  { key: "X-Frame-Options", value: "SAMEORIGIN" },
  { key: "X-Content-Type-Options", value: "nosniff" },
  { key: "X-XSS-Protection", value: "1; mode=block" },
  { key: "Referrer-Policy", value: "strict-origin-when-cross-origin" },
  {
    key: "Permissions-Policy",
    value: "camera=(), microphone=(), geolocation=()"
  }
]

module.exports = withBundleAnalyzer(
  withPWA({
    reactStrictMode: true,
    compress: true,
    poweredByHeader: false,
    // Type-check and lint run locally on every push (husky pre-push: tsc +
    // jest) — repeating tsc here OOM-kills Vercel's 2c/8GB build VM on
    // @huggingface/transformers' huge type surface. The deploy build only
    // compiles.
    typescript: { ignoreBuildErrors: true },
    eslint: { ignoreDuringBuilds: true },
    async headers() {
      return [
        {
          source: "/(.*)",
          headers: securityHeaders
        },
        {
          // Memory, exports and key flags are per-user and must not survive
          // in any cache the browser or a proxy keeps.
          source: "/api/(.*)",
          headers: [{ key: "Cache-Control", value: "no-store" }]
        }
      ]
    },
    images: {
      remotePatterns: [
        {
          protocol: "http",
          hostname: "localhost"
        },
        {
          protocol: "http",
          hostname: "127.0.0.1"
        },
        // Supabase storage for user avatars / file uploads
        {
          protocol: "https",
          hostname: "*.supabase.co"
        },
        // Supabase storage for self-hosted instances
        {
          protocol: "https",
          hostname: "*.supabase.in"
        }
      ]
    },
    // NEVER externalize or bundle @huggingface/transformers: Vercel
    // whole-copies externalized packages into functions (356MB > 250MB
    // limit, proven with a cache-free build), and its pre-bundled dist
    // breaks webpack on wasm/webgpu refs. It is loaded via an eval-hidden
    // dynamic import in lib/generate-local-embedding.ts instead, so no
    // build tool ever sees it. sharp/onnxruntime-node stay external for
    // self-hosted runtimes where the hidden import resolves them.
    serverExternalPackages: ["sharp", "onnxruntime-node"]
  })
)
