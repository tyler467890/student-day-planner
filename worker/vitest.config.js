import path from 'node:path';
import { cloudflareTest, readD1Migrations } from '@cloudflare/vitest-plugin';
import { defineConfig } from 'vitest/config';
import { generateSigningKeys } from '../js/unlock-token.js';

const migrations = await readD1Migrations(path.join(import.meta.dirname, 'migrations'));
const keys = await generateSigningKeys();

export default defineConfig({
  plugins: [
    cloudflareTest({
      wrangler: { configPath: './wrangler.toml' },
      miniflare: {
        // Throwaway test values only. Real ones are set with `wrangler secret put`.
        bindings: {
          TEST_MIGRATIONS: migrations,
          TEST_PUBLIC_KEY: keys.publicJwk,
          CODE_PEPPER: 'test-pepper-not-for-production',
          UNLOCK_SIGNING_KEY: JSON.stringify(keys.privateJwk),
          ADMIN_PASSWORD: 'test-admin-password-123',
          ALLOWED_ORIGINS: 'https://tyler467890.github.io,https://calo.ca,https://www.calo.ca',
        },
      },
    }),
  ],
  server: { fs: { allow: [path.join(import.meta.dirname, '..')] } },
  test: { setupFiles: ['./test/apply-migrations.js'] },
});
