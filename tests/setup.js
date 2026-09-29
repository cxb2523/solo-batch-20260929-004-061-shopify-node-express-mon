/**
 * Test-only environment defaults. The session adapter constructs a Cryptr
 * instance on import, so an encryption string must exist before the adapter
 * module is loaded.
 */
process.env.ENCRYPTION_STRING ||= "test-encryption-string";
