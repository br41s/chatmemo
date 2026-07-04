const withBundleAnalyzer = require("@next/bundle-analyzer")({
  enabled: process.env.ANALYZE === "true"
})

const withPWA = require("@ducanh2912/next-pwa").default({
  dest: "public"
})

const securityHeaders = [
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
    experimental: {
      // NEVER externalize or bundle @huggingface/transformers: Vercel
      // whole-copies externalized packages into functions (356MB > 250MB
      // limit, proven with a cache-free build), and its pre-bundled dist
      // breaks webpack on wasm/webgpu refs. It is loaded via an eval-hidden
      // dynamic import in lib/generate-local-embedding.ts instead, so no
      // build tool ever sees it. sharp/onnxruntime-node stay external for
      // self-hosted runtimes where the hidden import resolves them.
      serverComponentsExternalPackages: ["sharp", "onnxruntime-node"]
    }
  })
)
