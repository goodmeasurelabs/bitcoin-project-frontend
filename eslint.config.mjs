import { defineConfig, globalIgnores } from "eslint/config";
import nextVitals from "eslint-config-next/core-web-vitals";

export default defineConfig([
  ...nextVitals,
  // Keep pre-existing hydration/refresh effects visible without changing migration behavior.
  { files: ["src/app/House.js", "src/app/Item.tsx", "src/app/components/PurchasingPower.tsx", "src/app/directory/PriceDisplay.tsx"], rules: { "react-hooks/set-state-in-effect": "warn" } },
  { files: ["src/app/play/LiveGame.tsx"], rules: { "react-hooks/set-state-in-effect": "warn", "react-hooks/purity": "warn", "react-hooks/refs": "warn" } },
  globalIgnores([".next/**", ".open-next/**", ".worker-dry-run/**", ".test-build/**", "release-evidence/**", "next-env.d.ts"]),
]);
