const withBundleAnalyzer = require("@next/bundle-analyzer")({
  enabled: process.env.ANALYZE === "true"
})

const withPWA = require("@ducanh2912/next-pwa").default({
  dest: "public",
  // No runtime caching, and no cached start URL. The default rules kept every
  // same-origin GET under /api (memory exports, the timeline, the key flags)
  // and the page payload (which carries the profile, provider keys included)
  // in Cache Storage for a day, readable after sign-out on a shared device.
  // Static assets are still precached; the app is online-only anyway.
  // public/sw-cleanup.js deletes the caches a previous worker left behind.
  cacheStartUrl: false,
  dynamicStartUrl: false,
  workboxOptions: {
    runtimeCaching: [],
    importScripts: ["/sw-cleanup.js"]
  }
})

// The Supabase project that stores the user's uploads: the one remote host
// images may come from, in the policy header and in the image optimizer's
// allow-list alike. Exact host, so a self-hosted project works and no other
// project's subdomain does. Unset at build time (tests), nothing remote is
// allowed: the policy fails closed rather than falling back to a wildcard.
const storageUrl = (() => {
  try {
    return new URL(process.env.NEXT_PUBLIC_SUPABASE_URL)
  } catch {
    return null
  }
})()

// Image sources the browser may load, enforced by the browser itself: the
// markdown renderer refuses other sources too, but a policy header holds for
// every element on every page.
const devImageOrigins =
  process.env.NODE_ENV === "production"
    ? ""
    : " http://localhost:* http://127.0.0.1:*"
const contentSecurityPolicy = [
  `img-src 'self' data: blob:${storageUrl ? ` ${storageUrl.origin}` : ""}${devImageOrigins}`,
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
        // Supabase storage for user avatars / file uploads. The exact
        // project, not a wildcard: /_next/image fetches whatever URL it is
        // given that matches this list, so a wildcard would let an answer's
        // `![](/_next/image?url=https://<any-project>.supabase.co/…)` carry
        // data to any Supabase project through our own optimizer.
        ...(storageUrl
          ? [
              {
                protocol: storageUrl.protocol.replace(":", ""),
                hostname: storageUrl.hostname,
                ...(storageUrl.port ? { port: storageUrl.port } : {})
              }
            ]
          : [])
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
