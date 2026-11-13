import { defineConfig } from "vitest/config";

// Pruebas de integración contra el PostgreSQL LOCAL de Docker (base *_test).
// En serie: varias pruebas toman el candado global de row_version y la de la
// propiedad P mide concurrencia; correrlas en paralelo solo agrega ruido.
export default defineConfig({
  test: {
    include: ["test/integration/**/*.test.ts"],
    globalSetup: ["test/integration/global-setup.ts"],
    fileParallelism: false,
    testTimeout: 120_000,
    hookTimeout: 180_000,
  },
});
