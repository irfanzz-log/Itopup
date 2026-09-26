import nextConfig from "eslint-config-next";

export default [
  ...nextConfig,
  {
    ignores: [
      "node_modules/**",
      ".next/**",
      "generated/**",
      "prisma/migrations/**",
      "playwright-report/**",
      "test-results/**",
    ],
  },
  {
    rules: {
      "react/no-unescaped-entities": "off",
      "@next/next/no-html-link-for-pages": "off",
      "react-hooks/set-state-in-effect": "off",
      "react-hooks/immutability": "off",
      "react-hooks/refs": "off",
    },
  },
];
