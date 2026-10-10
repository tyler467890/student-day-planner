import path from 'node:path';
import { cloudflareTest } from '@cloudflare/vitest-plugin';
import { defineConfig } from 'vitest/config';
import { generateSigningKeys } from '../js/unlock-token.js';

const keys = await generateSigningKeys();

export default defineConfig({
  plugins: [
    cloudflareTest({
      wrangler: { configPath: './wrangler.toml' },
      miniflare: {
        // Throwaway test values only. Real ones are set with `wrangler secret put`.
        bindings: {
          TEST_PUBLIC_KEY: keys.publicJwk,
          CODE_PEPPER: 'test-pepper-not-for-production',
          UNLOCK_SIGNING_KEY: JSON.stringify(keys.privateJwk),
          ADMIN_PASSWORD: 'test-admin-password-123',
          ALLOWED_ORIGINS: 'https://tyler467890.github.io,https://caloplanner.com,https://www.caloplanner.com',
        },
      },
    }),
  ],
  server: { fs: { allow: [path.join(import.meta.dirname, '..')] } },
});
