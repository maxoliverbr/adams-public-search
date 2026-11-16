// Bun loads .env before preload. Use the real key if present (live tests run), else a fake (live tests skip).
if (!process.env.ADAMS_API_KEY && !process.env.ADAMSNRC_API_KEY) {
  process.env.ADAMS_API_KEY = "test-key";
  process.env.ADAMS_FAKE_KEY = "1";
}
