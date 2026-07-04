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
      // @huggingface/transformers must load natively (nested onnxruntime-node
      // ships .node binaries webpack cannot bundle)
      serverComponentsExternalPackages: [
        "sharp",
        "onnxruntime-node",
        "@huggingface/transformers"
      ]
    }
  })
)
