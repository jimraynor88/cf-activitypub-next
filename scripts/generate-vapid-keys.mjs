import crypto from "node:crypto";

const curve = crypto.createECDH("prime256v1");
curve.generateKeys();

const publicKey = curve.getPublicKey();
const privateKey = curve.getPrivateKey();

function base64url(buf) {
  return buf.toString("base64").replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
}

console.log("");
console.log("VAPID keys generated! Add these to your environment:");
console.log("");
console.log("  VAPID_PUBLIC_KEY=" + base64url(publicKey));
console.log("  VAPID_PRIVATE_KEY=" + base64url(privateKey));
console.log("  VAPID_EMAIL=mailto:admin@yourdomain.com");
console.log("");
console.log("For Cloudflare Pages:");
console.log("  npx wrangler secret put VAPID_PRIVATE_KEY");
console.log("  npx wrangler secret put VAPID_EMAIL");
console.log("  # VAPID_PUBLIC_KEY can be in wrangler.toml under [vars]");
console.log("");