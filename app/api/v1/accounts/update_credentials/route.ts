// PATCH /api/v1/accounts/update_credentials
// Re-exported from verify_credentials, which holds the full implementation
// (multipart + JSON, avatar/header upload, fields, auto-delete, federation).
export { PATCH } from "../verify_credentials/route";